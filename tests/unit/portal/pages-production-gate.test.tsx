/** @vitest-environment node */

import { renderToStaticMarkup } from "react-dom/server";

import { ApprovalsPageContent } from "@/app/(portal)/approvals/page";
import { CatalogPageContent } from "@/app/(portal)/catalog/page";
import { LoopsPageContent } from "@/app/(portal)/loops/page";
import { DashboardPageContent } from "@/app/(portal)/page";
import { SettingsPageContent } from "@/app/(portal)/settings/page";
import { repositories } from "@/db/schema";

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

  const productionEnv = { GITHUB_APP_ID: "800000", NODE_ENV: "production" } as const;

  beforeAll(async () => {
    context = await createPgliteTestDatabase();
  }, pgliteTestHookTimeoutMs);

  beforeEach(async () => {
    await context.reset();
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
          env: productionEnv,
          now: new Date("2026-08-06T12:00:00.000Z"),
        }),
      );

      expect(markup).toContain(emptyCopy);
      expect(markup).not.toContain("Portal data store unavailable.");
      expect(markup).toContain("Live database");
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
        env: productionEnv,
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
        env: productionEnv,
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
