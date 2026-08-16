import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";

const repoRoot = process.cwd();
const bundleRoot = path.join(repoRoot, ".omnigent/polly-loopworks");
const phaseSkillNames = ["browser-validate", "commit-signed-pr", "tdd-implement"];
const omnigentRevision = "ba241c3592000b8098101164d3de03d52ca74ddf";

const implementingWorkers = {
  sol: { harness: "codex-native", model: "gpt-5.6-sol" },
  luna: { harness: "codex-native", model: "gpt-5.6-luna" },
  terra: { harness: "codex-native", model: "gpt-5.6-terra" },
  opus: { harness: "claude-native", model: "claude-opus-5" },
} as const;

const reviewerWorkers = {
  reviewer_sol: { harness: "codex-native", model: "gpt-5.6-sol" },
  reviewer_opus: { harness: "claude-native", model: "claude-opus-5" },
} as const;

const expectedWorkers = { ...implementingWorkers, ...reviewerWorkers };

const handlers = {
  blastRadius: "omnigent.policies.builtins.orchestration.blast_radius",
  blockSkills: "omnigent.policies.builtins.safety.block_skills",
  cel: "omnigent.policies.builtins.cel.cel_policy",
  purposeGuard: "omnigent.policies.builtins.orchestration.headless_subagent_purpose_guard",
  readOnly: "omnigent.policies.builtins.orchestration.read_only_os",
  spawnBounds: "omnigent.policies.builtins.orchestration.spawn_bounds",
} as const;

type Policy = {
  on?: string[];
  function?: {
    path?: string;
    arguments?: Record<string, unknown>;
  };
};

type AgentConfig = {
  name?: string;
  skills?: string | string[];
  executor?: {
    model?: string;
    config?: { harness?: string; permission_mode?: string; yolo?: boolean };
  };
  os_env?: { cwd?: string; sandbox?: { type?: string; write_paths?: string[] } };
  guardrails?: { policies?: Record<string, Policy> };
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
  guardrails?: { policies?: Record<string, Policy> };
};

type MarkdownlintConfig = { ignores?: string[] };

function readYaml<T>(relativePath: string): T {
  const filePath = path.join(repoRoot, relativePath);
  expect(existsSync(filePath), `${relativePath} must exist`).toBe(true);
  return parse(readFileSync(filePath, "utf8")) as T;
}

function readAgent(name: keyof typeof expectedWorkers): AgentConfig {
  return readYaml<AgentConfig>(`.omnigent/polly-loopworks/agents/${name}/config.yaml`);
}

function policies(config: AgentConfig | OrchestratorConfig): Record<string, Policy> {
  return config.guardrails?.policies ?? {};
}

function policyExpression(policy: Policy | undefined): string {
  const expression = policy?.function?.arguments?.expression;
  expect(typeof expression).toBe("string");
  return expression as string;
}

type OmnigentSource = { revision: string; root: string };

let materializedOmnigentRoot: string | undefined;

const isolatedGitEnvironment = { ...process.env };
for (const key of Object.keys(isolatedGitEnvironment)) {
  if (key.startsWith("GIT_")) {
    delete isolatedGitEnvironment[key];
  }
}

function isolatedGit(args: string[]) {
  return spawnSync("git", args, {
    encoding: "utf8",
    env: isolatedGitEnvironment,
  });
}

function gitRevision(sourceRoot: string): string | undefined {
  const revision = isolatedGit(["-C", sourceRoot, "rev-parse", "HEAD"]);
  return revision.status === 0 ? revision.stdout.trim() : undefined;
}

function omnigentSource(): OmnigentSource | undefined {
  const configured = process.env.OMNIGENT_SOURCE_ROOT;
  if (configured && existsSync(path.join(configured, "omnigent/policies/builtins"))) {
    return { revision: gitRevision(configured) ?? "", root: configured };
  }
  if (!materializedOmnigentRoot) {
    materializedOmnigentRoot = mkdtempSync(
      path.join(os.tmpdir(), "loopworks-omnigent-policy-source-"),
    );
    const gitSteps = [
      ["init", materializedOmnigentRoot],
      [
        "-C",
        materializedOmnigentRoot,
        "remote",
        "add",
        "origin",
        "https://github.com/omnigent-ai/omnigent.git",
      ],
      ["-C", materializedOmnigentRoot, "fetch", "--depth=1", "origin", omnigentRevision],
      ["-C", materializedOmnigentRoot, "checkout", "--detach", "FETCH_HEAD"],
    ];
    for (const args of gitSteps) {
      const result = isolatedGit(args);
      if (result.status !== 0) {
        rmSync(materializedOmnigentRoot, { force: true, recursive: true });
        materializedOmnigentRoot = undefined;
        throw new Error(`Unable to fetch pinned Omnigent source: ${result.error ?? result.stderr}`);
      }
    }
  }
  return { revision: gitRevision(materializedOmnigentRoot) ?? "", root: materializedOmnigentRoot };
}

afterAll(() => {
  if (materializedOmnigentRoot) {
    rmSync(materializedOmnigentRoot, { force: true, recursive: true });
  }
});

describe("polly-loopworks bundle contract", () => {
  it("declares only the six enforceable, role-named workers", () => {
    const orchestrator = readYaml<OrchestratorConfig>(".omnigent/polly-loopworks/config.yaml");
    const expectedNames = Object.keys(expectedWorkers).sort();
    expect([...(orchestrator.tools?.agents ?? [])].sort()).toEqual(expectedNames);
    expect(orchestrator).toMatchObject({
      spawn: true,
      async: true,
      cancellable: true,
      timers: true,
    });
    expect(orchestrator.os_env).toBeDefined();
    expect(orchestrator.terminals).toHaveProperty("shell");

    const directoryNames = readdirSync(path.join(bundleRoot, "agents"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(directoryNames).toEqual(expectedNames);
    expect(directoryNames).not.toContain("gemini");
  });

  it("pins the exact harness and model for every worker and excludes Fable", () => {
    for (const [name, expected] of Object.entries(expectedWorkers)) {
      const config = readAgent(name as keyof typeof expectedWorkers);
      expect(config.name).toBe(name);
      expect(config.executor?.config?.harness).toBe(expected.harness);
      expect(config.executor?.model).toBe(expected.model);
      expect(config.executor?.model).not.toBe("claude-fable-5");
    }
  });

  it("binds both reviewers to read-only sandboxes and denies every shell", () => {
    for (const name of Object.keys(reviewerWorkers) as Array<keyof typeof reviewerWorkers>) {
      const config = readAgent(name);
      const workerPolicies = policies(config);
      expect(config.os_env?.sandbox).toMatchObject({
        type: "darwin_seatbelt",
        write_paths: [],
      });
      expect(config.os_env?.sandbox).toHaveProperty("cwd_allow_hidden");
      expect(
        (config.os_env?.sandbox as { cwd_allow_hidden?: string[] } | undefined)?.cwd_allow_hidden,
      ).toContain(".polly");
      expect(workerPolicies.read_only_os?.function?.path).toBe(handlers.readOnly);
      expect(workerPolicies.blast_radius).toMatchObject({
        on: ["tool_call"],
        function: {
          path: handlers.blastRadius,
          arguments: { gate_pushes: true },
        },
      });
      expect(workerPolicies.deny_shell?.function?.path).toBe(handlers.cel);
      const expression = policyExpression(workerPolicies.deny_shell);
      for (const shellTool of ["sys_os_shell", "Bash", "bash", "Shell", "terminal"]) {
        expect(expression).toContain(`"${shellTool}"`);
      }
    }

    expect(readAgent("reviewer_sol").executor?.config?.yolo).toBe(false);
    expect(readAgent("reviewer_opus").executor?.config?.permission_mode).toBe("plan");
  });

  it("does not claim worktree confinement that the runtime cannot enforce", () => {
    for (const name of Object.keys(implementingWorkers) as Array<
      keyof typeof implementingWorkers
    >) {
      const config = readAgent(name);
      expect(policies(config)).not.toHaveProperty("worktree_guard");
      expect(config.os_env?.cwd).toBe(".");
      expect(config.os_env?.sandbox?.type).toBe("none");
    }

    const routing = readFileSync(path.join(bundleRoot, "ROUTING.md"), "utf8");
    const adr = readFileSync(
      path.join(repoRoot, "docs/adr/0033-project-scoped-polly-model-routing.md"),
      "utf8",
    );
    expect(routing).not.toContain("worktree_guard");
    expect(adr).not.toContain("worktree_guard");
  });

  it("denies merge commands for the orchestrator and every implementer", () => {
    const actorConfigs: Array<AgentConfig | OrchestratorConfig> = [
      readYaml<OrchestratorConfig>(".omnigent/polly-loopworks/config.yaml"),
      ...Object.keys(implementingWorkers).map((name) =>
        readAgent(name as keyof typeof implementingWorkers),
      ),
    ];
    for (const config of actorConfigs) {
      const denyMerge = policies(config).deny_merge;
      expect(denyMerge?.function?.path).toBe(handlers.cel);
      const expression = policyExpression(denyMerge);
      expect(expression).toContain("gh\\\\s+pr\\\\s+merge");
      expect(expression).toContain('"DENY"');
    }
    expect(policies(actorConfigs[0]).blast_radius?.function?.arguments?.gate_pushes).toBe(true);
  });

  it("executes the configured CEL, skill, and direct-write denials", { timeout: 30_000 }, () => {
    const source = omnigentSource();
    expect(
      source,
      "set OMNIGENT_SOURCE_ROOT to the pinned Omnigent source checkout or fetch the pinned revision locally",
    ).toBeDefined();
    expect(source?.revision).toBe(omnigentRevision);
    const sourceRoot = source?.root as string;
    const orchestrator = readYaml<OrchestratorConfig>(".omnigent/polly-loopworks/config.yaml");
    const sol = readAgent("sol");
    const reviewer = readAgent("reviewer_sol");
    const payload = {
      customChild: policyExpression(policies(orchestrator).deny_claude_fable_5),
      merge: policyExpression(policies(orchestrator).deny_merge),
      nestedAgent: policyExpression(policies(sol).deny_nested_agents),
      reviewerShell: policyExpression(policies(reviewer).deny_shell),
    };
    const importPython = process.env.OMNIGENT_IMPORT_PYTHON;
    const command = importPython ?? "uv";
    const commandPrefix = importPython
      ? []
      : [
          "run",
          "--with",
          "cel-python==0.5.0",
          "--with",
          "pydantic>=2,<3",
          "--with",
          "pyyaml>=6,<7",
          "--no-project",
          "python",
        ];
    const probe = spawnSync(
      command,
      [
        ...commandPrefix,
        "-c",
        [
          "import json, sys",
          "from omnigent.policies.builtins.cel import cel_policy",
          "from omnigent.policies.builtins.orchestration import read_only_os",
          "from omnigent.policies.builtins.safety import block_skills",
          "expressions = json.loads(sys.argv[1])",
          "def call(name, arguments):",
          " return {'type': 'tool_call', 'data': {'name': name, 'arguments': arguments}}",
          "checks = {",
          " 'custom_child': cel_policy(expression=expressions['customChild'])(call('sys_session_create', {'config_path': 'x'})),",
          " 'merge': cel_policy(expression=expressions['merge'])(call('Bash', {'command': 'gh pr merge 268 --squash'})),",
          " 'benign_shell': cel_policy(expression=expressions['merge'])(call('Bash', {'command': 'git status'})),",
          " 'nested_agent': cel_policy(expression=expressions['nestedAgent'])(call('spawn_agent', {'task': 'review'})),",
          " 'reviewer_shell': cel_policy(expression=expressions['reviewerShell'])(call('Bash', {'command': 'printf x >> src/x.ts'})),",
          " 'blocked_skill': block_skills(blocked=['implement-issue', 'implement-issue-pr'])(call('Skill', {'skill': 'implement-issue-pr'})),",
          " 'direct_write': read_only_os()(call('Write', {'file_path': 'src/x.ts'}), {}),",
          "}",
          "expected = {'custom_child': 'DENY', 'merge': 'DENY', 'benign_shell': 'ALLOW', 'nested_agent': 'DENY', 'reviewer_shell': 'DENY', 'blocked_skill': 'DENY', 'direct_write': 'DENY'}",
          "bad = {name: checks[name] for name, verdict in expected.items() if not checks[name] or checks[name].get('result') != verdict}",
          "print(json.dumps({'checks': checks, 'bad': bad}, sort_keys=True))",
          "raise SystemExit(1 if bad else 0)",
        ].join("\n"),
        JSON.stringify(payload),
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PYTHONPATH: [sourceRoot, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
        },
      },
    );
    expect(probe.status, `${probe.stdout}\n${probe.stderr}`).toBe(0);
  });

  it("blocks harness-internal subagents and exposes only phase craft skills", () => {
    const blockedSkills = ["implement-issue", "implement-issue-pr"];
    for (const name of Object.keys(expectedWorkers) as Array<keyof typeof expectedWorkers>) {
      const config = readAgent(name);
      const workerPolicies = policies(config);
      const expectedSkills = name.startsWith("reviewer_") ? "none" : phaseSkillNames;
      expect(Array.isArray(config.skills) ? [...config.skills].sort() : config.skills).toEqual(
        expectedSkills,
      );
      expect(workerPolicies.block_orchestration_skills).toMatchObject({
        function: {
          path: handlers.blockSkills,
          arguments: { blocked: blockedSkills },
        },
      });
      expect(workerPolicies.deny_nested_agents?.function?.path).toBe(handlers.cel);
      const expression = policyExpression(workerPolicies.deny_nested_agents);
      for (const nestedTool of ["spawn_agent", "Agent", "Task"]) {
        expect(expression).toContain(`"${nestedTool}"`);
      }
    }
  });

  it("uses public policy paths that resolve through real Python imports", {
    timeout: 30_000,
  }, () => {
    const source = omnigentSource();
    expect(
      source,
      "set OMNIGENT_SOURCE_ROOT to the pinned Omnigent source checkout or fetch the pinned revision locally",
    ).toBeDefined();
    expect(source?.revision).toBe(omnigentRevision);
    const sourceRoot = source?.root as string;

    const allConfigs: Array<AgentConfig | OrchestratorConfig> = [
      readYaml<OrchestratorConfig>(".omnigent/polly-loopworks/config.yaml"),
      ...Object.keys(expectedWorkers).map((name) =>
        readAgent(name as keyof typeof expectedWorkers),
      ),
    ];
    const configuredPaths = [
      ...new Set(
        allConfigs.flatMap((config) =>
          Object.values(policies(config)).flatMap((policy) =>
            policy.function?.path ? [policy.function.path] : [],
          ),
        ),
      ),
    ].sort();

    expect(configuredPaths.every((handler) => handler.startsWith("omnigent.policies."))).toBe(true);
    const importPython = process.env.OMNIGENT_IMPORT_PYTHON;
    const command = importPython ?? "uv";
    const commandPrefix = importPython
      ? []
      : [
          "run",
          "--with",
          "cel-python==0.5.0",
          "--with",
          "pydantic>=2,<3",
          "--with",
          "pyyaml>=6,<7",
          "--no-project",
          "python",
        ];
    const probe = spawnSync(
      command,
      [
        ...commandPrefix,
        "-c",
        [
          "import importlib, json, sys",
          "paths = json.loads(sys.argv[1])",
          "missing = []",
          "for dotted in paths:",
          " module_name, attr = dotted.rsplit('.', 1)",
          " module = importlib.import_module(module_name)",
          " registry = getattr(module, 'POLICY_REGISTRY', [])",
          " if not callable(getattr(module, attr, None)) or not any(entry.get('handler') == dotted for entry in registry):",
          "  missing.append(dotted)",
          "print(json.dumps({'resolved': paths, 'missing': missing}))",
          "raise SystemExit(1 if missing else 0)",
        ].join("\n"),
        JSON.stringify(configuredPaths),
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PYTHONPATH: [sourceRoot, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
        },
      },
    );
    expect(probe.status, `${probe.stdout}\n${probe.stderr}`).toBe(0);
  });

  it("bounds orchestrator dispatch and denies custom children and Fable overrides", () => {
    const orchestrator = readYaml<OrchestratorConfig>(".omnigent/polly-loopworks/config.yaml");
    const orchestratorPolicies = policies(orchestrator);
    expect(orchestratorPolicies.spawn_bounds).toMatchObject({
      function: {
        path: handlers.spawnBounds,
        arguments: {
          dispatch_tools: ["sys_session_send", "sys_session_create"],
        },
      },
    });
    expect(orchestratorPolicies.headless_subagent_purpose_guard).toMatchObject({
      function: {
        path: handlers.purposeGuard,
        arguments: {
          allowed_purposes: ["implement", "review", "explore", "search"],
        },
      },
    });
    const expression = policyExpression(orchestratorPolicies.deny_claude_fable_5);
    expect(expression).toContain('event.data.name == "sys_session_create"');
    expect(expression).toContain("claude-fable-5");
    expect(orchestratorPolicies.deny_claude_fable_5?.on).toEqual(["tool_call"]);
  });

  it("requires an accurate reviewer-model and author-lineage record on every PR", () => {
    const orchestrator = readYaml<OrchestratorConfig>(".omnigent/polly-loopworks/config.yaml");
    expect(orchestrator.prompt).toContain("every PR body");
    expect(orchestrator.prompt).toContain("Reviewer A model");
    expect(orchestrator.prompt).toContain("Reviewer B model");
    expect(orchestrator.prompt).toContain("shared the author's model lineage");
    expect(orchestrator.prompt).not.toContain("reviewed without vendor independence");
  });

  it("defines a single-PR managed sequence with phase headers and a transition ledger", () => {
    const skill = readFileSync(path.join(bundleRoot, "skills/implement-issue-pr/SKILL.md"), "utf8");
    expect(skill).toContain("Single PR only");
    expect(skill).not.toMatch(/stacked PR|gh-stack/i);
    for (const field of ["ROLE:", "PHASE:", "DONE:", "YOU PRODUCE:", "YOU DO NOT:", "NEXT:"]) {
      expect(skill).toContain(field);
    }
    expect(skill).toContain("Every `args.input` must begin");
    expect(skill).toContain(".polly/workflow-state.md");
    expect(skill).toContain("append after every phase transition");
  });

  it("splits phase craft from the thin human-facing composers", () => {
    const skillText = new Map(
      phaseSkillNames.map((name) => [
        name,
        readFileSync(path.join(repoRoot, `.agents/skills/${name}/SKILL.md`), "utf8"),
      ]),
    );
    for (const [name, skill] of skillText) {
      expect(skill).not.toMatch(/^## Subagents$/m);
      expect(skill).not.toMatch(/adversarial review/i);
      expect(skill).not.toMatch(/spawn (?:a )?subagent/i);
      expect(skill).not.toMatch(/phase \d/i);
      expect(skill.length, `${name} must stay concise and craft-scoped`).toBeLessThan(12_000);
    }

    const implementIssue = readFileSync(
      path.join(repoRoot, ".agents/skills/implement-issue/SKILL.md"),
      "utf8",
    );
    const implementIssuePr = readFileSync(
      path.join(repoRoot, ".agents/skills/implement-issue-pr/SKILL.md"),
      "utf8",
    );
    for (const composer of [implementIssue, implementIssuePr]) {
      expect(composer).toContain("## Managed mode");
      expect(composer).toContain("tdd-implement");
      expect(composer).toContain("browser-validate");
      expect(composer).not.toMatch(/^## Subagents$/m);
    }
    expect(implementIssuePr).toContain("commit-signed-pr");
    expect(implementIssue).not.toContain("git commit -S");
  });

  it("protects ignored Polly scratch from cleanup and Markdownlint", () => {
    const gitignore = readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
    expect(gitignore).toContain(".polly/");
    expect(gitignore).toContain("agents must not delete");
    const markdownlint = readYaml<MarkdownlintConfig>(".markdownlint-cli2.yaml");
    expect(markdownlint.ignores).toContain(".polly");
  });
});
