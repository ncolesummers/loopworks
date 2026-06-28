import { existsSync, readFileSync } from "node:fs";

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
});
