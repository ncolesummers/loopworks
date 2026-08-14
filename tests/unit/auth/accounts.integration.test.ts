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
