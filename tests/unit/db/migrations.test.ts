/** @vitest-environment node */
import { existsSync, readdirSync, readFileSync } from "node:fs";

import { repositories } from "@/db/schema";
import { createPgliteTestDatabase } from "../../helpers/pglite";

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

  it("replays generated migrations against a clean Postgres-compatible database", async () => {
    const context = await createPgliteTestDatabase();

    try {
      expect(await context.db.select().from(repositories)).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
