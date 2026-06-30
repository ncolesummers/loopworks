/** @vitest-environment node */
import { eq } from "drizzle-orm";

import { loops, repositories, vercelProjects } from "@/db/schema";
import { createRepoRecordFromProjection } from "@/lib/catalog/repo-record";
import { createPgliteTestDatabase, type PgliteTestDatabase } from "../../helpers/pglite";

describe("repo catalog projection", () => {
  let context: PgliteTestDatabase;

  beforeEach(async () => {
    context = await createPgliteTestDatabase();
  });

  afterEach(async () => {
    await context.close();
  });

  it("materializes a RepoRecord from durable repository, loop, and Vercel rows", async () => {
    const [repository] = await context.db
      .insert(repositories)
      .values({
        githubRepoId: 1001,
        owner: "ncolesummers",
        name: "loopworks-web",
        fullName: "ncolesummers/loopworks-web",
        health: "blocked",
        framework: "Next.js",
        defaultBranch: "main",
        ciCommands: ["bun run validate", "bun run build"],
        docsHref: "https://github.com/ncolesummers/loopworks/tree/main/docs",
        observabilityHref:
          "https://github.com/ncolesummers/loopworks/blob/main/docs/observability.md",
        designSystemHref:
          "https://github.com/ncolesummers/loopworks/blob/main/docs/design-review-checklist.md",
        enabledLoops: ["Intake and triage", "Review gate"],
        validationGates: ["Typecheck", "Playwright"],
        lastSyncedAt: new Date("2026-06-28T12:00:00.000Z"),
      })
      .returning();

    await context.db.insert(loops).values([
      {
        repositoryId: repository.id,
        githubIssueNumber: 8,
        title: "Repo catalog MVP",
        state: "blocked",
        milestone: "M2",
        areaLabel: "area:catalog",
        priorityLabel: "priority:p0",
        lastSyncedAt: new Date("2026-06-29T12:00:00.000Z"),
      },
      {
        repositoryId: repository.id,
        githubIssueNumber: 9,
        title: "Vercel deployment and preview visibility",
        state: "in_progress",
        milestone: "M2",
        areaLabel: "area:vercel",
        priorityLabel: "priority:p0",
        lastSyncedAt: new Date("2026-06-29T13:00:00.000Z"),
      },
    ]);

    const [vercelProject] = await context.db
      .insert(vercelProjects)
      .values({
        repositoryId: repository.id,
        projectId: "prj_loopworks",
        projectName: "loopworks",
        dashboardUrl: "https://vercel.com/ncolesummers/loopworks",
      })
      .returning();

    const repositoryLoops = await context.db
      .select()
      .from(loops)
      .where(eq(loops.repositoryId, repository.id));

    expect(
      createRepoRecordFromProjection({
        repository,
        loops: repositoryLoops,
        vercelProject,
        now: new Date("2026-06-30T12:00:00.000Z"),
      }),
    ).toEqual({
      name: "loopworks-web",
      owner: "ncolesummers",
      description: "Catalog projection for ncolesummers/loopworks-web.",
      health: "blocked",
      githubHref: "https://github.com/ncolesummers/loopworks-web",
      framework: "Next.js",
      defaultBranch: "main",
      ciCommands: ["bun run validate", "bun run build"],
      docsHref: "https://github.com/ncolesummers/loopworks/tree/main/docs",
      observabilityHref:
        "https://github.com/ncolesummers/loopworks/blob/main/docs/observability.md",
      designSystemHref:
        "https://github.com/ncolesummers/loopworks/blob/main/docs/design-review-checklist.md",
      enabledLoops: ["Intake and triage", "Review gate"],
      validationGates: ["Typecheck", "Playwright"],
      vercelProjectId: "prj_loopworks",
      vercelProjectHref: "https://vercel.com/ncolesummers/loopworks",
      milestone: "M2",
      area: "catalog",
      priority: "p0",
      openIssues: 2,
      staleDays: 2,
      lastSynced: "2d ago",
    });
  });
});
