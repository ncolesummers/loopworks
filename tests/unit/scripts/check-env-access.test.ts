import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { findDirectProcessEnvReads } from "../../../scripts/check-env-access";

async function writeSource(root: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

describe("direct process.env access guard", () => {
  it("rejects dot and bracket value reads with actionable locations", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "loopworks-env-access-"));
    await writeSource(root, "src/direct.ts", "export const value = process.env.SECRET;\n");
    await writeSource(root, "agent/bracket.ts", 'export const value = process.env["TOKEN"];\n');

    await expect(findDirectProcessEnvReads(root)).resolves.toEqual([
      expect.objectContaining({
        path: "agent/bracket.ts",
        line: 1,
        expression: 'process.env["TOKEN"]',
      }),
      expect.objectContaining({ path: "src/direct.ts", line: 1, expression: "process.env.SECRET" }),
    ]);
  });

  it("rejects direct value reads in JSX production sources", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "loopworks-env-access-"));
    await writeSource(
      root,
      "src/direct.jsx",
      "export const Example = () => <div>{process.env.JSX_SECRET}</div>;\n",
    );

    await expect(findDirectProcessEnvReads(root)).resolves.toEqual([
      expect.objectContaining({
        path: "src/direct.jsx",
        line: 1,
        expression: "process.env.JSX_SECRET",
      }),
    ]);
  });

  it("rejects destructuring, computed env access, and parenthesized reads", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "loopworks-env-access-"));
    await writeSource(
      root,
      "src/bypasses.ts",
      'const { AUTH_SECRET } = process.env;\nprocess["env"].DATABASE_URL;\n(process.env).TOKEN;\nlet secret; ({ secret } = process.env);\nglobalThis.process.env.AUTH_SECRET;\n',
    );
    await writeSource(root, "src/module.mts", "process.env.MODULE_SECRET;\n");
    await writeSource(root, "agent/module.cts", "process.env.AGENT_SECRET;\n");

    await expect(findDirectProcessEnvReads(root)).resolves.toEqual([
      expect.objectContaining({ path: "agent/module.cts", expression: "process.env.AGENT_SECRET" }),
      expect.objectContaining({ line: 1, expression: "process.env" }),
      expect.objectContaining({ line: 2, expression: 'process["env"].DATABASE_URL' }),
      expect.objectContaining({ line: 3, expression: "(process.env).TOKEN" }),
      expect.objectContaining({ line: 4, expression: "process.env" }),
      expect.objectContaining({ line: 5, expression: "globalThis.process.env.AUTH_SECRET" }),
      expect.objectContaining({ path: "src/module.mts", expression: "process.env.MODULE_SECRET" }),
    ]);
  });

  it("allows bare environment injection and ignores tests and the registry implementation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "loopworks-env-access-"));
    await writeSource(
      root,
      "src/injected.ts",
      "export function read(env: Partial<NodeJS.ProcessEnv> = process.env) { return env.VALUE; }\n",
    );
    await writeSource(root, "tests/unit/raw.test.ts", "process.env.SECRET;\n");
    await writeSource(root, "src/lib/config/registry.ts", "process.env.SECRET;\n");
    await writeSource(root, "src/lib/config/extra.ts", "process.env.SECRET;\n");

    await expect(findDirectProcessEnvReads(root)).resolves.toEqual([
      expect.objectContaining({
        path: "src/lib/config/extra.ts",
        expression: "process.env.SECRET",
      }),
    ]);
  });

  it("allows only Next's compile-time NEXT_RUNTIME gate at the instrumentation boundary", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "loopworks-env-access-"));
    await writeSource(
      root,
      "src/instrumentation.ts",
      "process.env.NEXT_RUNTIME;\nprocess.env.NODE_ENV;\n",
    );

    await expect(findDirectProcessEnvReads(root)).resolves.toEqual([
      expect.objectContaining({
        path: "src/instrumentation.ts",
        line: 2,
        expression: "process.env.NODE_ENV",
      }),
    ]);
  });

  it("finds no direct value reads in repository production sources", async () => {
    await expect(findDirectProcessEnvReads(process.cwd())).resolves.toEqual([]);
  });
});
