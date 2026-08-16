import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const repoRoot = process.cwd();
const bundleRoot = path.join(repoRoot, ".omnigent/polly-loopworks");

const expectedWorkers = {
  sol: { harness: "codex-native", model: "gpt-5.6-sol", guardrail: "worktree_guard" },
  luna: { harness: "codex-native", model: "gpt-5.6-luna", guardrail: "worktree_guard" },
  terra: { harness: "codex-native", model: "gpt-5.6-terra", guardrail: "worktree_guard" },
  opus: { harness: "claude-native", model: "claude-opus-5", guardrail: "worktree_guard" },
  reviewer_sol: {
    harness: "codex-native",
    model: "gpt-5.6-sol",
    guardrail: "read_only_os",
  },
  reviewer_opus: {
    harness: "claude-native",
    model: "claude-opus-5",
    guardrail: "read_only_os",
  },
  gemini: {
    harness: "antigravity-native",
    model: undefined,
    guardrail: "read_only_os",
  },
} as const;

type AgentConfig = {
  name?: string;
  executor?: { model?: string; config?: { harness?: string } };
  os_env?: { sandbox?: { type?: string } };
  guardrails?: { policies?: Record<string, unknown> };
};

type OrchestratorConfig = {
  spawn?: boolean;
  async?: boolean;
  cancellable?: boolean;
  timers?: boolean;
  os_env?: unknown;
  terminals?: Record<string, unknown>;
  tools?: { agents?: string[] };
  prompt?: string;
  guardrails?: {
    policies?: Record<
      string,
      {
        on?: string[];
        function?: {
          path?: string;
          arguments?: { expression?: string; [key: string]: unknown };
        };
      }
    >;
  };
};

type MarkdownlintConfig = { ignores?: string[] };

function readYaml<T>(relativePath: string): T {
  const filePath = path.join(repoRoot, relativePath);
  expect(existsSync(filePath), `${relativePath} must exist`).toBe(true);
  return parse(readFileSync(filePath, "utf8")) as T;
}

describe("polly-loopworks bundle contract", () => {
  it("encodes the issue #267 roster, routing, guardrails, and workflow invariants", () => {
    const orchestrator = readYaml<OrchestratorConfig>(".omnigent/polly-loopworks/config.yaml");
    const expectedNames = Object.keys(expectedWorkers).sort();
    const declaredNames = [...(orchestrator.tools?.agents ?? [])].sort();

    expect(declaredNames).toEqual(expectedNames);
    expect(orchestrator).toMatchObject({
      spawn: true,
      async: true,
      cancellable: true,
      timers: true,
    });
    expect(orchestrator.os_env).toBeDefined();
    expect(orchestrator.terminals).toHaveProperty("shell");

    const agentsRoot = path.join(bundleRoot, "agents");
    const directoryNames = readdirSync(agentsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(directoryNames).toEqual(expectedNames);

    for (const [name, expected] of Object.entries(expectedWorkers)) {
      const config = readYaml<AgentConfig>(`.omnigent/polly-loopworks/agents/${name}/config.yaml`);
      expect(config.name).toBe(name);
      expect(config.executor?.config?.harness).toBe(expected.harness);
      expect(config.executor?.model).toBe(expected.model);
      expect(config.guardrails?.policies).toHaveProperty(expected.guardrail);
      expect(config.guardrails?.policies?.[expected.guardrail]).toMatchObject({
        function: {
          path: `omnigent.inner.nessie.policies.${expected.guardrail}`,
        },
      });
      expect(config.executor?.model).not.toBe("claude-fable-5");
      if (expected.guardrail === "read_only_os") {
        expect(config.os_env?.sandbox).toEqual({});
      }
    }

    const policies = orchestrator.guardrails?.policies ?? {};
    expect(policies.spawn_bounds).toMatchObject({
      function: {
        path: "omnigent.inner.nessie.policies.spawn_bounds",
        arguments: {
          dispatch_tools: ["sys_session_send", "sys_session_create"],
        },
      },
    });
    expect(policies.headless_subagent_purpose_guard).toMatchObject({
      function: {
        path: "omnigent.inner.nessie.policies.headless_subagent_purpose_guard",
        arguments: {
          allowed_purposes: ["implement", "review", "explore", "search"],
        },
      },
    });
    const fablePolicy = Object.values(policies).find(
      (policy) => policy.function?.path === "omnigent.policies.builtins.cel.cel_policy",
    );
    expect(fablePolicy).toMatchObject({ on: ["tool_call"] });
    const fableExpression = fablePolicy?.function?.arguments?.expression;
    expect(fableExpression).toContain("event.data.arguments.args.model");
    expect(fableExpression).toContain("claude-fable-5");
    expect(fableExpression).toContain('event.data.name == "sys_session_create"');

    expect(orchestrator.prompt).toContain("Reviewer A");
    expect(orchestrator.prompt).toContain("Reviewer B");
    expect(orchestrator.prompt).toContain("Every issue implementation");
    expect(orchestrator.prompt).toContain("reviewed without vendor independence");

    const skill = readFileSync(path.join(bundleRoot, "skills/implement-issue-pr/SKILL.md"), "utf8");
    expect(skill).toContain("Phases 3 and 4");
    expect(skill).toContain("ONE worker session");
    expect(skill).toContain("IMPLEMENTING worker");
    expect(skill).toContain("run serially");
    expect(skill).toContain("same turn");
    expect(skill).toContain("referenced by path");
    expect(skill).toContain("orchestrator never edits the diff");
    expect(skill).toContain("orchestrator never merges");

    const gitignore = readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
    expect(gitignore).toContain(".polly/");
    expect(gitignore).toContain("agents must not delete");

    const markdownlint = readYaml<MarkdownlintConfig>(".markdownlint-cli2.yaml");
    expect(markdownlint.ignores).toContain(".polly");
  });
});
