/** @vitest-environment node */
import { existsSync, readdirSync, readFileSync } from "node:fs";

import {
  approvalTransitionEvents,
  artifacts,
  artifactTypeEnum,
  idempotencyLocks,
  loopRuns,
  repositories,
  runTerminalReasonEnum,
} from "@/db/schema";
import { createPgliteTestDatabase } from "../../helpers/pglite";

const migrationReplayTimeoutMs = 15_000;

function readMigrationSql() {
  return readdirSync("drizzle")
    .filter((entry) => entry.endsWith(".sql"))
    .map((entry) => readFileSync(`drizzle/${entry}`, "utf8"))
    .join("\n");
}

describe("Drizzle migrations", () => {
  it("keeps generated migration metadata trackable for clean replay", () => {
    expect(existsSync("drizzle/meta/_journal.json")).toBe(true);

    const ignoredEntries = readFileSync(".gitignore", "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    expect(ignoredEntries).not.toContain("drizzle/meta");
    expect(ignoredEntries).not.toContain("drizzle/meta/");
  });

  it("tracks repo catalog projection fields in schema and migrations", () => {
    expect(Object.keys(repositories)).toEqual(
      expect.arrayContaining([
        "health",
        "framework",
        "defaultBranch",
        "ciCommands",
        "docsHref",
        "observabilityHref",
        "designSystemHref",
        "enabledLoops",
        "validationGates",
        "lastSyncedAt",
      ]),
    );

    const migrationSql = readMigrationSql();
    for (const column of [
      "health",
      "framework",
      "default_branch",
      "ci_commands",
      "docs_href",
      "observability_href",
      "design_system_href",
      "enabled_loops",
      "validation_gates",
      "last_synced_at",
    ]) {
      expect(migrationSql).toContain(`"${column}"`);
    }
  });

  it("tracks approval transition audit state in schema and migrations", () => {
    expect(Object.keys(approvalTransitionEvents)).toEqual(
      expect.arrayContaining([
        "approvalId",
        "fromStatus",
        "toStatus",
        "action",
        "actorId",
        "occurredAt",
        "note",
      ]),
    );

    const migrationSql = readMigrationSql();
    expect(migrationSql).toContain('"approval_transition_events"');
    expect(migrationSql).toContain("'bypassed'");
  });

  it("tracks typed run terminal reasons in schema and migrations", () => {
    expect(runTerminalReasonEnum.enumValues).toEqual([
      "succeeded",
      "failed",
      "timed_out",
      "stalled",
      "canceled_by_reconciliation",
    ]);
    expect(Object.keys(loopRuns)).toContain("terminalReason");

    const migrationSql = readMigrationSql();
    expect(migrationSql).toContain('CREATE TYPE "public"."run_terminal_reason"');
    expect(migrationSql).toContain('"terminal_reason" "run_terminal_reason"');
  });

  it("tracks dispatch lease correlation and active issue uniqueness", () => {
    expect(Object.keys(idempotencyLocks)).toEqual(expect.arrayContaining(["runId", "traceId"]));

    const migrationSql = readMigrationSql();
    expect(migrationSql).toContain('"run_id" uuid');
    expect(migrationSql).toContain('"trace_id" text');
    expect(migrationSql).toContain("loop_runs_active_repository_issue_idx");
    expect(migrationSql).toContain("'waiting_for_approval', 'blocked'");
    expect(migrationSql).toContain('"loop_runs"."completed_at" IS NULL');
  });

  it(
    "creates screenshot artifacts in the fresh migration baseline",
    async () => {
      expect(artifactTypeEnum.enumValues).toContain("screenshot");
      const migrationFiles = readdirSync("drizzle").filter((entry) => entry.endsWith(".sql"));
      expect(migrationFiles).toHaveLength(1);

      const migrationSql = readMigrationSql();
      expect(migrationSql).toContain(
        "CREATE TYPE \"public\".\"artifact_type\" AS ENUM('plan', 'validation_report', 'test_plan', 'patch', 'pr_intent', 'deployment_summary', 'log_summary', 'trace', 'screenshot', 'other')",
      );
      expect(migrationSql).not.toContain('ALTER TYPE "public"."artifact_type" ADD VALUE');

      const context = await createPgliteTestDatabase();
      try {
        const [repository] = await context.db
          .insert(repositories)
          .values({
            githubRepoId: 49_000_001,
            owner: "ncolesummers",
            name: "loopworks",
            fullName: "ncolesummers/loopworks",
          })
          .returning();
        if (!repository) throw new Error("Expected repository fixture.");
        const runId = "00000000-0000-4000-8000-000000000049";
        await context.db.insert(loopRuns).values({
          id: runId,
          loopKey: "development-loop",
          repositoryId: repository.id,
        });
        const [artifact] = await context.db
          .insert(artifacts)
          .values({
            runId: "00000000-0000-4000-8000-000000000049",
            title: "Validation screenshots",
            type: "screenshot",
            uri: "artifact://screenshots/manifest",
          })
          .returning();
        expect(artifact?.type).toBe("screenshot");
      } finally {
        await context.close();
      }
    },
    migrationReplayTimeoutMs,
  );

  it(
    "replays generated migrations against a clean Postgres-compatible database",
    async () => {
      const context = await createPgliteTestDatabase();

      try {
        expect(await context.db.select().from(repositories)).toEqual([]);
      } finally {
        await context.close();
      }
    },
    migrationReplayTimeoutMs,
  );
});
