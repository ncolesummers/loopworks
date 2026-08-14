/** @vitest-environment node */

import { githubInstallationFlows, githubInstallations } from "@/db/schema";
import {
  createGithubInstallationFlow,
  type GithubInstallationGateway,
} from "@/lib/github/installation-flow";
import {
  createGithubInstallationStore,
  type GithubInstallationDatabase,
} from "@/lib/github/installation-store";
import { deriveFirstRunState } from "@/lib/onboarding/first-run-state";
import { type PortalRecordsDatabase, readPortalRecords } from "@/lib/portal/records";
import {
  createPgliteTestDatabase,
  type PgliteTestDatabase,
  pgliteTestHookTimeoutMs,
} from "../../helpers/pglite";

const appId = 124;
const installationId = 124_001;
const now = new Date("2026-08-05T12:00:00.000Z");

/**
 * The already-installed dead end (#151) is only fixed if reconciliation reaches
 * a real connected row through the real store, and if its challenge keeps every
 * ADR 0021 guarantee while carrying no candidate installation.
 */
describe("GitHub App installation reconciliation over a real store", () => {
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

  function gateway(overrides: Partial<GithubInstallationGateway> = {}): GithubInstallationGateway {
    return {
      async exchangeUserCode() {
        return "ghu_transient_user_token";
      },
      async getAuthenticatedUserProviderAccountId() {
        return "22808397";
      },
      async listInstallationRepositories() {
        return [];
      },
      async listUserInstallations() {
        return [{ appId, installationId }];
      },
      async userCanAccessInstallation() {
        return true;
      },
      async verifyAppInstallation(candidate) {
        return {
          accountId: 12_400,
          accountLogin: "loopworks-sandbox",
          accountType: "Organization",
          appId,
          installationId: candidate,
          repositorySelection: "selected",
        };
      },
      ...overrides,
    };
  }

  // `state_digest` is globally unique, so two flows sharing one database need
  // distinct state secrets.
  function flow(overrides: Partial<GithubInstallationGateway> = {}, label = "reconcile") {
    const secrets = [`${label}-state`, `${label}-verifier`];
    return createGithubInstallationFlow({
      config: {
        appId,
        callbackUrl: "https://loopworks.vercel.app/api/github/install/callback",
        clientId: "Iv1.loopworks",
        clientSecret: "github-app-client-secret",
        slug: "loopworks-dev",
      },
      gateway: gateway(overrides),
      generateSecret: () => secrets.shift() ?? "extra-secret",
      now: () => now,
      store: createGithubInstallationStore(context.db as unknown as GithubInstallationDatabase),
    });
  }

  async function firstRunState() {
    return deriveFirstRunState({
      result: await readPortalRecords({
        database: context.db as unknown as PortalRecordsDatabase,
        githubAppId: appId,
        now,
      }),
    });
  }

  function callback(
    reconcileFlow: ReturnType<typeof flow>,
    options: { actorId?: string; label?: string } = {},
  ) {
    const label = options.label ?? "reconcile";
    return reconcileFlow.callback({
      actorId: options.actorId ?? "ncolesummers",
      authorizationCode: "one-time-code",
      error: null,
      mode: "github",
      githubProviderAccountId: "22808397",
      installationId: null,
      pkceVerifier: `${label}-verifier`,
      setupAction: null,
      githubInstallationState: `${label}-state`,
    });
  }

  it("moves the operator off no-installation without any setup-url callback", async () => {
    await expect(firstRunState()).resolves.toEqual({
      stage: "no-installation",
      status: "onboarding",
    });

    const reconcileFlow = flow();
    await reconcileFlow.startReconciliation({ actorId: "ncolesummers" });

    const challenges = await context.db.select().from(githubInstallationFlows);
    expect(challenges).toHaveLength(1);
    expect(challenges[0]).toMatchObject({
      actorId: "ncolesummers",
      consumedAt: null,
      installationId: null,
      phase: "authorization",
    });
    expect(JSON.stringify(challenges)).not.toContain("reconcile-state");

    await expect(callback(reconcileFlow)).resolves.toEqual({
      kind: "settings",
      outcome: "connected",
    });

    const rows = await context.db.select().from(githubInstallations);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      accountLogin: "loopworks-sandbox",
      appId,
      installationId,
      installedBy: "ncolesummers",
    });
    await expect(firstRunState()).resolves.toEqual({
      stage: "no-repositories",
      status: "onboarding",
    });
  });

  it("consumes the reconciliation challenge once, and only for its own actor", async () => {
    const replayed = flow();
    await replayed.startReconciliation({ actorId: "ncolesummers" });
    await expect(callback(replayed)).resolves.toEqual({
      kind: "settings",
      outcome: "connected",
    });
    await expect(callback(replayed)).resolves.toEqual({ kind: "settings", outcome: "error" });
    expect(await context.db.select().from(githubInstallations)).toHaveLength(1);

    await context.reset();

    const crossActor = flow();
    await crossActor.startReconciliation({ actorId: "ncolesummers" });
    await expect(callback(crossActor, { actorId: "somebody-else" })).resolves.toEqual({
      kind: "settings",
      outcome: "error",
    });
    expect(await context.db.select().from(githubInstallations)).toEqual([]);
    await expect(firstRunState()).resolves.toEqual({
      stage: "no-installation",
      status: "onboarding",
    });
  });

  it("writes nothing when the operator controls no installation of the configured app", async () => {
    const empty = flow({ listUserInstallations: async () => [] });
    await empty.startReconciliation({ actorId: "ncolesummers" });

    await expect(callback(empty)).resolves.toEqual({
      kind: "settings",
      outcome: "no-installation-found",
    });
    expect(await context.db.select().from(githubInstallations)).toEqual([]);
    await expect(firstRunState()).resolves.toEqual({
      stage: "no-installation",
      status: "onboarding",
    });
  });

  /**
   * `/settings/repositories` resolves an installation by lowest id with no actor
   * scoping, so a second reconciliation row would silently repoint the portal at
   * an unrelated account the operator merely belongs to. Reconciliation refuses
   * once the portal is connected.
   */
  it("refuses to add a second installation once the portal is connected", async () => {
    const first = flow();
    await first.startReconciliation({ actorId: "ncolesummers" });
    await callback(first);

    const second = flow(
      {
        listUserInstallations: async () => [{ appId, installationId: 900_001 }],
      },
      "second",
    );
    await second.startReconciliation({ actorId: "another-operator" });
    await expect(
      callback(second, { actorId: "another-operator", label: "second" }),
    ).resolves.toEqual({
      kind: "settings",
      outcome: "already-connected",
    });

    const rows = await context.db.select().from(githubInstallations);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.installationId).toBe(installationId);
    expect(rows[0]?.installedBy).toBe("ncolesummers");
  });

  it("ignores an installation row left behind by a different app", async () => {
    await context.db.insert(githubInstallations).values({
      accountId: 99_400,
      accountLogin: "someone-elses-app",
      accountType: "Organization",
      appId: 999,
      installationId: 999_001,
      installedBy: "ncolesummers",
      repositorySelection: "all",
    });

    const reconcileFlow = flow();
    await reconcileFlow.startReconciliation({ actorId: "ncolesummers" });
    await expect(callback(reconcileFlow)).resolves.toEqual({
      kind: "settings",
      outcome: "connected",
    });

    const rows = await context.db.select().from(githubInstallations);
    expect(rows.map((row) => row.installationId).sort()).toEqual([installationId, 999_001]);
  });
});
