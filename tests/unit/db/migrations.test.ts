/** @vitest-environment node */
import { existsSync, readdirSync, readFileSync } from "node:fs";

import {
  approvalTransitionEvents,
  artifacts,
  artifactTypeEnum,
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

  it(
    "tracks screenshot artifacts in the schema and generated migrations",
    async () => {
      expect(artifactTypeEnum.enumValues).toContain("screenshot");
      const migrationSql = readMigrationSql();
      expect(migrationSql).toContain("ADD VALUE 'screenshot'");
      expect(migrationSql).toContain("screenshot_evidence_contract");
      expect(migrationSql).toContain('WHERE "run_steps"."stage" = \'validation\'');

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
