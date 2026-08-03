/** @vitest-environment node */

import { githubInstallationFlows, githubInstallations } from "@/db/schema";
import {
  createGithubInstallationStore,
  digestGithubInstallationState,
  type GithubInstallationDatabase,
} from "@/lib/github/installation-store";
import {
  createPgliteTestDatabase,
  type PgliteTestDatabase,
  pgliteTestHookTimeoutMs,
} from "../../helpers/pglite";

describe("GitHub installation persistence", () => {
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

  function store() {
    return createGithubInstallationStore(context.db as unknown as GithubInstallationDatabase);
  }

  it("tracks independent installations and one-time actor-bound callback state", () => {
    expect(Object.keys(githubInstallations)).toEqual(
      expect.arrayContaining([
        "installationId",
        "appId",
        "accountId",
        "accountLogin",
        "accountType",
        "repositorySelection",
        "installedBy",
      ]),
    );
    expect(Object.keys(githubInstallationFlows)).toEqual(
      expect.arrayContaining([
        "stateDigest",
        "actorId",
        "phase",
        "installationId",
        "expiresAt",
        "consumedAt",
      ]),
    );
  });

  it("atomically consumes an unexpired challenge once for its actor and phase", async () => {
    const installationStore = store();
    const stateDigest = digestGithubInstallationState("opaque-install-state");
    await installationStore.createChallenge({
      actorId: "ncolesummers",
      expiresAt: new Date("2026-08-03T04:10:00.000Z"),
      phase: "installation",
      stateDigest,
    });

    await expect(
      installationStore.consumeChallenge({
        actorId: "somebody-else",
        now: new Date("2026-08-03T04:05:00.000Z"),
        phase: "installation",
        stateDigest,
      }),
    ).resolves.toBeNull();

    const results = await Promise.all([
      installationStore.consumeChallenge({
        actorId: "ncolesummers",
        now: new Date("2026-08-03T04:05:00.000Z"),
        phase: "installation",
        stateDigest,
      }),
      installationStore.consumeChallenge({
        actorId: "ncolesummers",
        now: new Date("2026-08-03T04:05:00.000Z"),
        phase: "installation",
        stateDigest,
      }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    await expect(
      installationStore.consumeChallenge({
        actorId: "ncolesummers",
        now: new Date("2026-08-03T04:05:00.000Z"),
        phase: "authorization",
        stateDigest,
      }),
    ).resolves.toBeNull();
  });

  it("rejects expired state and keeps globally duplicate installations idempotent", async () => {
    const installationStore = store();
    const stateDigest = digestGithubInstallationState("expired-state");
    await installationStore.createChallenge({
      actorId: "ncolesummers",
      expiresAt: new Date("2026-08-03T04:00:00.000Z"),
      phase: "installation",
      stateDigest,
    });
    await expect(
      installationStore.consumeChallenge({
        actorId: "ncolesummers",
        now: new Date("2026-08-03T04:00:00.001Z"),
        phase: "installation",
        stateDigest,
      }),
    ).resolves.toBeNull();

    const installation = {
      accountId: 12_400,
      accountLogin: "loopworks-org",
      accountType: "Organization",
      appId: 124,
      installationId: 124_001,
      installedAt: new Date("2026-08-03T04:05:00.000Z"),
      installedBy: "ncolesummers",
      repositorySelection: "selected",
      updatedAt: new Date("2026-08-03T04:05:00.000Z"),
    };
    await expect(installationStore.connectInstallation(installation)).resolves.toBe("connected");
    await expect(
      installationStore.connectInstallation({
        ...installation,
        accountLogin: "renamed-loopworks-org",
        installedBy: "another-operator",
        repositorySelection: "all",
        updatedAt: new Date("2026-08-03T04:06:00.000Z"),
      }),
    ).resolves.toBe("already-connected");

    const rows = await context.db.select().from(githubInstallations);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      installationId: 124_001,
      installedBy: "ncolesummers",
      accountLogin: "renamed-loopworks-org",
      repositorySelection: "all",
      installedAt: new Date("2026-08-03T04:05:00.000Z"),
      updatedAt: new Date("2026-08-03T04:06:00.000Z"),
    });
  });

  it("does not let stale or cross-App callbacks overwrite installation metadata", async () => {
    const installationStore = store();
    const currentInstallation = {
      accountId: 12_400,
      accountLogin: "current-loopworks-org",
      accountType: "Organization",
      appId: 124,
      installationId: 124_001,
      installedAt: new Date("2026-08-03T04:05:00.000Z"),
      installedBy: "ncolesummers",
      repositorySelection: "all",
      updatedAt: new Date("2026-08-03T04:06:00.000Z"),
    };
    await installationStore.connectInstallation(currentInstallation);

    await installationStore.connectInstallation({
      ...currentInstallation,
      accountLogin: "stale-loopworks-org",
      repositorySelection: "selected",
      updatedAt: new Date("2026-08-03T04:05:30.000Z"),
    });
    await installationStore.connectInstallation({
      ...currentInstallation,
      accountLogin: "other-app-org",
      appId: 999,
      updatedAt: new Date("2026-08-03T04:07:00.000Z"),
    });

    await expect(context.db.select().from(githubInstallations)).resolves.toEqual([
      expect.objectContaining({
        accountLogin: "current-loopworks-org",
        appId: 124,
        repositorySelection: "all",
        updatedAt: new Date("2026-08-03T04:06:00.000Z"),
      }),
    ]);
  });
});
