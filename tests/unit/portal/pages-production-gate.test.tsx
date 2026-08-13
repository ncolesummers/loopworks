/** @vitest-environment node */

import { renderToStaticMarkup } from "react-dom/server";

import { ApprovalsPageContent } from "@/app/(portal)/approvals/page";
import { CatalogPageContent } from "@/app/(portal)/catalog/page";
import { LoopsPageContent } from "@/app/(portal)/loops/page";
import { DashboardPageContent } from "@/app/(portal)/page";
import { SettingsPageContent } from "@/app/(portal)/settings/page";
import { repositories, storeIdentity } from "@/db/schema";
import {
  provisionStoreIdentity,
  type StoreIdentityProvisionDatabase,
} from "@/lib/portal/store-identity";

import {
  createPgliteTestDatabase,
  type PgliteTestDatabase,
  pgliteTestHookTimeoutMs,
} from "../../helpers/pglite";

/**
 * These render the portal surfaces through the real `getPortalRecordsForPortal`
 * production gate against a reachable database, rather than injecting a `result`
 * prop — which short-circuits the gate and would pass even with the #155 bug in
 * place.
 */
describe("portal surfaces through the production data gate", () => {
  let context: PgliteTestDatabase;

  const otherStoreId = "018f7c2e-0000-7c3d-9e4f-2a6b8c0d1e2f";

  /*
   * Minted by the store rather than fixed by the test. A real install's identity
   * comes from migration 0003's `gen_random_uuid()`, so an operator's configured
   * value can only ever be a copy of what the database already chose. Asserting
   * against a shared literal instead would make the fresh-install case pass by
   * construction and prove nothing about the flow production actually takes.
   */
  let expectedStoreId: string;
  function productionEnv() {
    return {
      GITHUB_APP_ID: "800000",
      LOOPWORKS_EXPECTED_STORE_ID: expectedStoreId,
      NODE_ENV: "production",
    } as const;
  }

  beforeAll(async () => {
    context = await createPgliteTestDatabase();
  }, pgliteTestHookTimeoutMs);

  beforeEach(async () => {
    await context.reset();
    // What makes the empty database below a *correctly provisioned* fresh install
    // rather than one that was emptied: `reset` truncates the identity row with
    // everything else, and the difference between those two stores is the whole
    // subject of #158. The store mints the value, exactly as the migration does.
    const provisioned = await provisionStoreIdentity({
      database: context.db as unknown as StoreIdentityProvisionDatabase,
    });
    expectedStoreId = provisioned.storeId;
  }, pgliteTestHookTimeoutMs);

  afterAll(async () => {
    await context.close();
  }, pgliteTestHookTimeoutMs);

  it.each([
    ["Dashboard", DashboardPageContent, "No loops tracked"],
    // An empty production database is a first-run install, so the catalog names the stage the
    // operator is actually on rather than reporting a bare absence (#127, ADR 0019).
    ["Catalog", CatalogPageContent, "No GitHub App installation connected"],
    ["Loops", LoopsPageContent, "No loops tracked"],
    ["Approvals", ApprovalsPageContent, "No approval gates available"],
    ["Settings", SettingsPageContent, "No installation connected"],
  ] as const)(
    "%s page renders its own empty state for a reachable empty production database",
    async (_area, PageContent, emptyCopy) => {
      const markup = renderToStaticMarkup(
        await PageContent({
          database: context.db,
          env: productionEnv(),
          now: new Date("2026-08-06T12:00:00.000Z"),
        }),
      );

      expect(markup).toContain(emptyCopy);
      expect(markup).not.toContain("Portal data store unavailable.");
      expect(markup).toContain("Live database");
    },
  );

  /**
   * The other half of the pair above, and the defect in #158: the database here is
   * just as reachable and just as empty, but it is not the store this deployment
   * expects. Before this gate both cases rendered identically — "Live database"
   * over empty panels — so the operator was told to install a GitHub App to fix a
   * database misconfiguration.
   */
  it.each([
    ["Dashboard", DashboardPageContent, "No loops tracked"],
    ["Catalog", CatalogPageContent, "No GitHub App installation connected"],
    ["Loops", LoopsPageContent, "No loops tracked"],
    ["Approvals", ApprovalsPageContent, "No approval gates available"],
    ["Settings", SettingsPageContent, "No installation connected"],
  ] as const)(
    "%s page refuses to render a normal empty state when the store is not the expected one",
    async (_area, PageContent, emptyCopy) => {
      const markup = renderToStaticMarkup(
        await PageContent({
          database: context.db,
          env: { ...productionEnv(), LOOPWORKS_EXPECTED_STORE_ID: otherStoreId },
          now: new Date("2026-08-06T12:00:00.000Z"),
        }),
      );

      expect(markup).toContain("Portal data store identity is unverified.");
      expect(markup).not.toContain(emptyCopy);
      expect(markup).not.toContain("Live database");
    },
  );

  /**
   * The documented reset in
   * `docs/runbooks/github-repository-selection-verification.md` produces exactly
   * this state: the expected store, emptied.
   */
  it.each([
    ["Dashboard", DashboardPageContent, "No loops tracked"],
    ["Catalog", CatalogPageContent, "No GitHub App installation connected"],
    ["Loops", LoopsPageContent, "No loops tracked"],
    ["Approvals", ApprovalsPageContent, "No approval gates available"],
    ["Settings", SettingsPageContent, "No installation connected"],
  ] as const)(
    "%s page refuses to render a normal empty state when the expected store was emptied",
    async (_area, PageContent, emptyCopy) => {
      await context.db.delete(storeIdentity);

      const markup = renderToStaticMarkup(
        await PageContent({
          database: context.db,
          env: productionEnv(),
          now: new Date("2026-08-06T12:00:00.000Z"),
        }),
      );

      expect(markup).toContain("Portal data store identity is unverified.");
      expect(markup).not.toContain(emptyCopy);
      expect(markup).not.toContain("Live database");
    },
  );

  /**
   * #158 AC4. The connect action is the specific harm: an operator following it
   * installs a second App against a database that was never the problem.
   */
  it.each([
    ["is not the expected one", false],
    ["was emptied", true],
  ] as const)(
    "Settings page offers no connection action when the store %s",
    async (_case, emptyTheStore) => {
      // Resolved in the body, not the table: `expectedStoreId` is minted per test
      // in `beforeEach`, and a table literal is evaluated at collection time when
      // it is still undefined.
      if (emptyTheStore) {
        await context.db.delete(storeIdentity);
      }
      const configuredStoreId = emptyTheStore ? expectedStoreId : otherStoreId;

      const markup = renderToStaticMarkup(
        await SettingsPageContent({
          database: context.db,
          env: { ...productionEnv(), LOOPWORKS_EXPECTED_STORE_ID: configuredStoreId },
          now: new Date("2026-08-06T12:00:00.000Z"),
        }),
      );

      expect(markup).not.toContain('href="/api/github/install"');
      expect(markup).not.toContain('href="/api/github/install/reconcile"');
      expect(markup).not.toContain("Not connected");
      expect(markup).toContain("Connection unknown");
    },
  );

  /**
   * #151: the install link dead-ends when the account already has the App, so a
   * disconnected Settings page must also route the operator to reconciliation.
   */
  it("Settings page offers both connection routes on a reachable empty production database", async () => {
    const markup = renderToStaticMarkup(
      await SettingsPageContent({
        database: context.db,
        env: productionEnv(),
        now: new Date("2026-08-06T12:00:00.000Z"),
      }),
    );

    expect(markup).toContain('href="/api/github/install"');
    expect(markup).toContain('href="/api/github/install/reconcile"');
    expect(markup).toContain("Not connected");
  });

  it("Catalog page lists a selected repository with no loops, deployments, or approvals present", async () => {
    // The shape repository selection actually writes: no Vercel project link, no
    // loops, never synced.
    await context.db.insert(repositories).values({
      fullName: "loopworks-sandbox/portal-web",
      githubRepoId: 900_100,
      installationId: 151_596_823,
      name: "portal-web",
      owner: "loopworks-sandbox",
    });

    const markup = renderToStaticMarkup(
      await CatalogPageContent({
        database: context.db,
        env: productionEnv(),
        now: new Date("2026-08-06T12:00:00.000Z"),
      }),
    );

    expect(markup).toContain("loopworks-sandbox/portal-web");
    // A selected repository must not still read as first-run emptiness.
    expect(markup).not.toContain("No repositories selected yet");
    expect(markup).not.toContain("No GitHub App installation connected");
    expect(markup).not.toContain("Portal data store unavailable.");
    expect(markup).toContain("Live database");
  });
});
