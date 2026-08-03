import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { configRegistry } from "@/lib/config/registry";
import {
  checkEnvExample,
  renderEnvExample,
  syncEnvExample,
} from "../../../scripts/sync-env-example";

function assignmentNames(content: string): string[] {
  return content
    .split("\n")
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
    .map((line) => line.slice(0, line.indexOf("=")));
}

describe("sync-env-example", () => {
  it("renders every user-configurable registry entry in declaration order", () => {
    const rendered = renderEnvExample();

    expect(assignmentNames(rendered)).toEqual(
      configRegistry.filter((entry) => !entry.readOnly).map((entry) => entry.name),
    );
    expect(rendered).toContain("# Generated from src/lib/config/registry.ts.");
    expect(rendered).toContain('AUTH_SECRET="replace-with-auth-secret"');
    expect(rendered).not.toContain("loopworks-local-development-secret");
    expect(rendered.endsWith("\n")).toBe(true);
    expect(rendered.endsWith("\n\n")).toBe(false);
  });

  it("reports a missing or stale environment example", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "loopworks-env-example-"));

    await expect(checkEnvExample(root)).resolves.toMatchObject({ ok: false, reason: "missing" });
    await writeFile(path.join(root, ".env.example"), "STALE=true\n");
    await expect(checkEnvExample(root)).resolves.toMatchObject({ ok: false, reason: "stale" });
  });

  it("writes the generated example idempotently", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "loopworks-env-example-"));
    await mkdir(root, { recursive: true });

    await expect(syncEnvExample(root)).resolves.toMatchObject({ ok: true, changed: true });
    await expect(readFile(path.join(root, ".env.example"), "utf8")).resolves.toBe(
      renderEnvExample(),
    );
    await expect(syncEnvExample(root)).resolves.toMatchObject({ ok: true, changed: false });
  });

  it("wires generation and drift/access checks into package scripts", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts["config:sync"]).toContain("sync-env-example.ts --write");
    expect(packageJson.scripts["config:check"]).toContain("sync-env-example.ts --check");
    expect(packageJson.scripts["config:access-check"]).toContain("check-env-access.ts");
    expect(packageJson.scripts.validate).toContain("bun run config:check");
    expect(packageJson.scripts.validate).toContain("bun run config:access-check");
  });
});
