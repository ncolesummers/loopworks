/** @vitest-environment node */

import { accounts, users } from "@/db/schema";
import { type AuthAccountDatabase, createAuthAccountReader } from "@/lib/auth/accounts";
import {
  createPgliteTestDatabase,
  type PgliteTestDatabase,
  pgliteTestHookTimeoutMs,
} from "../../helpers/pglite";

describe("Auth.js GitHub account reader", () => {
  let context: PgliteTestDatabase;

  beforeAll(async () => {
    context = await createPgliteTestDatabase();
  }, pgliteTestHookTimeoutMs);

  beforeEach(async () => {
    await context.reset();
  }, pgliteTestHookTimeoutMs);

  afterAll(async () => {
    await context.close();
  }, pgliteTestHookTimeoutMs);

  function reader() {
    return createAuthAccountReader(context.db as unknown as AuthAccountDatabase);
  }

  async function createUser(githubLogin: string): Promise<string> {
    const [user] = await context.db
      .insert(users)
      .values({ githubLogin, name: githubLogin })
      .returning({ id: users.id });
    if (!user) throw new Error("Expected the Auth.js user fixture to be created.");
    return user.id;
  }

  it("returns the one canonical GitHub provider account id without returning token material", async () => {
    const userId = await createUser("reader-operator");
    await context.db.insert(accounts).values({
      access_token: "ghu_token_canary",
      provider: "github",
      providerAccountId: "22808397",
      type: "oauth",
      userId,
    });

    await expect(reader().readGithubProviderAccountIdForUser(userId)).resolves.toBe("22808397");
  });

  it("returns access evidence only for the unique account matching the session subject", async () => {
    const userId = await createUser("selection-operator");
    await context.db.insert(accounts).values({
      access_token: "ghu_selection_token_canary",
      provider: "github",
      providerAccountId: "22808397",
      type: "oauth",
      userId,
    });

    await expect(
      reader().readGithubAccessEvidenceForSubject({
        authUserId: userId,
        githubProviderAccountId: "22808397",
      }),
    ).resolves.toEqual({ accessToken: "ghu_selection_token_canary" });
  });

  it("fails access evidence closed for blank, missing, ambiguous, malformed, or mismatched rows", async () => {
    const missingUserId = await createUser("missing-selection-operator");
    await expect(
      reader().readGithubAccessEvidenceForSubject({
        authUserId: missingUserId,
        githubProviderAccountId: "22808397",
      }),
    ).resolves.toBeNull();

    const malformedUserId = await createUser("malformed-selection-operator");
    await context.db.insert(accounts).values({
      access_token: " ghu_malformed_canary ",
      provider: "github",
      providerAccountId: "not-canonical",
      type: "oauth",
      userId: malformedUserId,
    });
    await expect(
      reader().readGithubAccessEvidenceForSubject({
        authUserId: malformedUserId,
        githubProviderAccountId: "22808397",
      }),
    ).resolves.toBeNull();

    const mismatchUserId = await createUser("mismatched-selection-operator");
    await context.db.insert(accounts).values({
      access_token: "ghu_mismatch_canary",
      provider: "github",
      providerAccountId: "99900001",
      type: "oauth",
      userId: mismatchUserId,
    });
    await expect(
      reader().readGithubAccessEvidenceForSubject({
        authUserId: mismatchUserId,
        githubProviderAccountId: "22808397",
      }),
    ).resolves.toBeNull();

    const ambiguousUserId = await createUser("ambiguous-selection-operator");
    await context.db.insert(accounts).values([
      {
        access_token: "ghu_first_canary",
        provider: "github",
        providerAccountId: "22808397",
        type: "oauth",
        userId: ambiguousUserId,
      },
      {
        access_token: "ghu_second_canary",
        provider: "github",
        providerAccountId: "99900002",
        type: "oauth",
        userId: ambiguousUserId,
      },
    ]);
    await expect(
      reader().readGithubAccessEvidenceForSubject({
        authUserId: ambiguousUserId,
        githubProviderAccountId: "22808397",
      }),
    ).resolves.toBeNull();

    await expect(
      reader().readGithubAccessEvidenceForSubject({
        authUserId: " ",
        githubProviderAccountId: "22808397",
      }),
    ).resolves.toBeNull();
    await expect(
      reader().readGithubAccessEvidenceForSubject({
        authUserId: missingUserId,
        githubProviderAccountId: "00022808397",
      }),
    ).resolves.toBeNull();
  });

  it("rotates the persisted access token when an existing GitHub account signs in again", async () => {
    const userId = await createUser("returning-selection-operator");
    await context.db.insert(accounts).values({
      access_token: "ghu_expired_token_canary",
      provider: "github",
      providerAccountId: "22808397",
      type: "oauth",
      userId,
    });

    await expect(
      reader().refreshGithubAccessTokenForAccount({
        accessToken: "ghu_fresh_token_canary",
        providerAccountId: "22808397",
      }),
    ).resolves.toBeUndefined();
    await expect(
      reader().readGithubAccessEvidenceForSubject({
        authUserId: userId,
        githubProviderAccountId: "22808397",
      }),
    ).resolves.toEqual({ accessToken: "ghu_fresh_token_canary" });
  });

  it("does not rotate another account for malformed or missing sign-in token evidence", async () => {
    const userId = await createUser("guarded-selection-operator");
    await context.db.insert(accounts).values({
      access_token: "ghu_original_token_canary",
      provider: "github",
      providerAccountId: "22808397",
      type: "oauth",
      userId,
    });

    await reader().refreshGithubAccessTokenForAccount({
      accessToken: " ghu_whitespace_canary ",
      providerAccountId: "22808397",
    });
    await reader().refreshGithubAccessTokenForAccount({
      accessToken: "ghu_wrong_account_canary",
      providerAccountId: "not-canonical",
    });
    await reader().refreshGithubAccessTokenForAccount({
      accessToken: "ghu_new_account_canary",
      providerAccountId: "99900001",
    });

    await expect(
      reader().readGithubAccessEvidenceForSubject({
        authUserId: userId,
        githubProviderAccountId: "22808397",
      }),
    ).resolves.toEqual({ accessToken: "ghu_original_token_canary" });
  });

  it("fails closed for blank, missing, or ambiguous GitHub account evidence", async () => {
    const userId = await createUser("ambiguous-operator");

    await expect(reader().readGithubProviderAccountIdForUser(" ")).resolves.toBeNull();
    await expect(reader().readGithubProviderAccountIdForUser(userId)).resolves.toBeNull();

    await context.db.insert(accounts).values([
      {
        provider: "github",
        providerAccountId: "22808397",
        type: "oauth",
        userId,
      },
      {
        provider: "github",
        providerAccountId: "99900001",
        type: "oauth",
        userId,
      },
    ]);

    await expect(reader().readGithubProviderAccountIdForUser(userId)).resolves.toBeNull();
  });
});
