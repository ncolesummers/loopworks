import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  CLAUDE_SHIM_CONTENT,
  checkAgentDocs,
  discoverAgentDocs,
  syncAgentDocs,
} from "../../../scripts/sync-agent-docs";

const createTempRepo = async () => {
  return mkdtemp(path.join(tmpdir(), "loopworks-agent-docs-"));
};

const writeRepoFile = async (root: string, relativePath: string, content: string) => {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
};

describe("sync-agent-docs", () => {
  let root: string;

  beforeEach(async () => {
    root = await createTempRepo();
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it("defines the exact generated Claude shim", () => {
    expect(
      CLAUDE_SHIM_CONTENT,
    ).toBe(`<!-- Generated from AGENTS.md. Edit AGENTS.md and run \`bun run agent-docs:sync\`. -->
@AGENTS.md
`);
  });

  it("discovers canonical AGENTS.md files while ignoring generated and fixture directories", async () => {
    await writeRepoFile(root, "AGENTS.md", "# Root\n");
    await writeRepoFile(root, "src/AGENTS.md", "# Source\n");
    await writeRepoFile(root, ".git/AGENTS.md", "# Ignore\n");
    await writeRepoFile(root, "node_modules/pkg/AGENTS.md", "# Ignore\n");
    await writeRepoFile(root, ".next/AGENTS.md", "# Ignore\n");
    await writeRepoFile(root, "storybook-static/AGENTS.md", "# Ignore\n");
    await writeRepoFile(root, "coverage/AGENTS.md", "# Ignore\n");
    await writeRepoFile(root, "playwright-report/AGENTS.md", "# Ignore\n");
    await writeRepoFile(root, "test-results/AGENTS.md", "# Ignore\n");
    await writeRepoFile(root, "fixtures/AGENTS.md", "# Ignore\n");
    await writeRepoFile(root, "__fixtures__/AGENTS.md", "# Ignore\n");

    await expect(discoverAgentDocs(root)).resolves.toEqual(["AGENTS.md", "src/AGENTS.md"]);
  });

  it("reports missing, stale, orphaned, and wrong-case Claude files", async () => {
    await writeRepoFile(root, "AGENTS.md", "# Root\n");
    await writeRepoFile(root, "src/AGENTS.md", "# Source\n");
    await writeRepoFile(root, "src/CLAUDE.md", "# Old\n");
    await writeRepoFile(root, "docs/CLAUDE.md", CLAUDE_SHIM_CONTENT);
    await writeRepoFile(root, "agent/AGENTS.md", "# Agent\n");
    await writeRepoFile(root, "agent/claude.md", CLAUDE_SHIM_CONTENT);
    await writeRepoFile(root, "bad/agents.md", "# Wrong case\n");

    const result = await checkAgentDocs(root);

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "CLAUDE.md", type: "missing-claude" }),
        expect.objectContaining({ path: "src/CLAUDE.md", type: "stale-claude" }),
        expect.objectContaining({ path: "docs/CLAUDE.md", type: "orphan-claude" }),
        expect.objectContaining({ path: "agent/claude.md", type: "wrong-case-claude" }),
        expect.objectContaining({ path: "bad/agents.md", type: "wrong-case-agents" }),
      ]),
    );
  });

  it("rejects symlinked instruction files before write mode can follow them", async () => {
    const outsideTarget = path.join(await createTempRepo(), "outside-claude.md");
    await writeFile(outsideTarget, "outside content\n");
    await writeRepoFile(root, "AGENTS.md", "# Root\n");
    await symlink(outsideTarget, path.join(root, "CLAUDE.md"));

    const result = await syncAgentDocs(root, { write: true });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "CLAUDE.md", type: "symlink-instruction" }),
      ]),
    );
    await expect(readFile(outsideTarget, "utf8")).resolves.toBe("outside content\n");
  });

  it("writes only generated Claude shims and leaves AGENTS.md content untouched", async () => {
    const rootAgents = "# Root\n";
    const srcAgents = "# Source\n";
    await writeRepoFile(root, "AGENTS.md", rootAgents);
    await writeRepoFile(root, "src/AGENTS.md", srcAgents);
    await writeRepoFile(root, "src/CLAUDE.md", "# Old\n");

    const result = await syncAgentDocs(root, { write: true });

    expect(result.ok).toBe(true);
    expect(result.changed).toEqual(["CLAUDE.md", "src/CLAUDE.md"]);
    await expect(readFile(path.join(root, "AGENTS.md"), "utf8")).resolves.toBe(rootAgents);
    await expect(readFile(path.join(root, "src/AGENTS.md"), "utf8")).resolves.toBe(srcAgents);
    await expect(readFile(path.join(root, "CLAUDE.md"), "utf8")).resolves.toBe(CLAUDE_SHIM_CONTENT);
    await expect(readFile(path.join(root, "src/CLAUDE.md"), "utf8")).resolves.toBe(
      CLAUDE_SHIM_CONTENT,
    );
  });
});
