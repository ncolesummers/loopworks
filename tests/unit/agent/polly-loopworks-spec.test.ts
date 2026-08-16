import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const repoRoot = process.cwd();
const bundleRoot = path.join(repoRoot, ".omnigent/polly-loopworks");
const orchestrationSkillPath = path.join(bundleRoot, "skills/orchestrate-issue-pr/SKILL.md");
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
  if (!configured) {
    return undefined;
  }
  if (!existsSync(path.join(configured, "omnigent/policies/builtins"))) {
    throw new Error(
      `OMNIGENT_SOURCE_ROOT does not contain omnigent/policies/builtins: ${configured}`,
    );
  }
  return { revision: gitRevision(configured) ?? "", root: configured };
}

const runtimePolicyTest = process.env.OMNIGENT_SOURCE_ROOT ? it : it.skip;

describe("polly-loopworks bundle contract", () => {
  it("keeps the default invariant suite independent of an external Omnigent checkout", () => {
    const suiteSource = readFileSync(
      path.join(repoRoot, "tests/unit/agent/polly-loopworks-spec.test.ts"),
      "utf8",
    );

    expect(suiteSource).not.toContain(
      ["https:", "", "github.com", "omnigent-ai", "omnigent.git"].join("/"),
    );
    expect(suiteSource).not.toContain(
      [["fe", "tch"].join(""), ["--depth", "=1"].join("")]
        .map((value) => JSON.stringify(value))
        .join(", "),
    );
  });

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

  it("configures reviewer restrictions and records the codex-native fail-open gap", () => {
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

    for (const relativePath of [
      ".omnigent/polly-loopworks/ROUTING.md",
      "docs/adr/0034-project-scoped-polly-model-routing.md",
    ]) {
      const text = readFileSync(path.join(repoRoot, relativePath), "utf8");
      expect(text).toContain("fail open");
      expect(text).toContain("policy_hook_disabled_reason");
      expect(text).not.toContain("## Binding controls");
    }
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
      path.join(repoRoot, "docs/adr/0034-project-scoped-polly-model-routing.md"),
      "utf8",
    );
    const adrIndex = readFileSync(path.join(repoRoot, "docs/adr/README.md"), "utf8");
    const orchestrator = readFileSync(path.join(bundleRoot, "config.yaml"), "utf8");
    const orchestrationSkill = readFileSync(orchestrationSkillPath, "utf8");
    expect(routing).not.toContain("worktree_guard");
    expect(adr).not.toContain("worktree_guard");
    for (const text of [routing, adr, orchestrator, orchestrationSkill]) {
      expect(text).not.toContain("OMNIGENT_RUNNER_WORKSPACE");
      expect(text).not.toContain("runtime resolver probe");
    }
    expect(adrIndex).toContain("[0034](0034-project-scoped-polly-model-routing.md)");
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
      expect(expression).toContain("--repo");
      expect(expression).toContain("api");
      expect(expression).toContain("pulls");
      expect(expression).toContain('"DENY"');
    }
    expect(policies(actorConfigs[0]).blast_radius?.function?.arguments?.gate_pushes).toBe(true);

    for (const relativePath of [
      ".omnigent/polly-loopworks/ROUTING.md",
      "docs/adr/0034-project-scoped-polly-model-routing.md",
    ]) {
      const text = readFileSync(path.join(repoRoot, relativePath), "utf8");
      expect(text).toContain("best-effort speed bump");
      expect(text).toContain("branch protection");
      expect(text).toContain("token without merge scope");
      expect(text).toContain("out of scope");
    }
  });

  it("does not present ignored function-policy on fields as an enforcement boundary", () => {
    const configs: Array<AgentConfig | OrchestratorConfig> = [
      readYaml<OrchestratorConfig>(".omnigent/polly-loopworks/config.yaml"),
      ...Object.keys(expectedWorkers).map((name) =>
        readAgent(name as keyof typeof expectedWorkers),
      ),
    ];

    for (const config of configs) {
      for (const [name, policy] of Object.entries(policies(config))) {
        expect(policy.on, `${name} must rely on its handler to self-select events`).toBeUndefined();
      }
    }
  });

  runtimePolicyTest(
    "executes every roster actor's denial policies behaviorally",
    { timeout: 30_000 },
    () => {
      const source = omnigentSource();
      expect(
        source,
        "OMNIGENT_SOURCE_ROOT must point to the pinned Omnigent checkout",
      ).toBeDefined();
      expect(source?.revision).toBe(omnigentRevision);
      const sourceRoot = source?.root as string;
      const actorConfigs = {
        orchestrator: readYaml<OrchestratorConfig>(".omnigent/polly-loopworks/config.yaml"),
        ...Object.fromEntries(
          Object.keys(expectedWorkers).map((name) => [
            name,
            readAgent(name as keyof typeof expectedWorkers),
          ]),
        ),
      };
      const payload = Object.fromEntries(
        Object.entries(actorConfigs).map(([name, config]) => [name, policies(config)]),
      );
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
            "from omnigent.policies.builtins.orchestration import blast_radius, read_only_os",
            "from omnigent.policies.builtins.safety import block_skills",
            "actors = json.loads(sys.argv[1])",
            "def call(name, arguments=None):",
            " return {'type': 'tool_call', 'data': {'name': name, 'arguments': arguments or {}}}",
            "checks = {}",
            "bad = {}",
            "def check(label, result, expected):",
            " checks[label] = result",
            " if not result or result.get('result') != expected: bad[label] = {'expected': expected, 'actual': result}",
            "merge_commands = ['gh pr merge 268 --squash', 'gh -R owner/repo pr merge 268', 'gh --repo=owner/repo pr merge 268', 'gh api -X PUT repos/owner/repo/pulls/268/merge']",
            "nested_tools = ['spawn_agent', 'Agent', 'Task', 'TaskCreate', 'sys_session_send', 'sys_session_create']",
            "shell_tools = ['sys_os_shell', 'Bash', 'bash', 'Shell', 'terminal', 'execute_code', 'developer__shell']",
            "write_tools = ['sys_os_write', 'sys_os_edit', 'Write', 'Edit', 'MultiEdit', 'write', 'edit']",
            "for actor, actor_policies in actors.items():",
            " for policy_name, policy in actor_policies.items():",
            "  handler = policy.get('function', {}).get('path')",
            "  arguments = policy.get('function', {}).get('arguments') or {}",
            "  prefix = f'{actor}.{policy_name}'",
            "  if policy_name == 'deny_merge':",
            "   evaluate = cel_policy(expression=arguments['expression'])",
            "   for index, shell_command in enumerate(merge_commands): check(f'{prefix}.deny.{index}', evaluate(call('Bash', {'command': shell_command})), 'DENY')",
            "   check(f'{prefix}.allow', evaluate(call('Bash', {'command': 'git status'})), 'ALLOW')",
            "  elif policy_name == 'deny_nested_agents':",
            "   evaluate = cel_policy(expression=arguments['expression'])",
            "   for tool in nested_tools: check(f'{prefix}.deny.{tool}', evaluate(call(tool, {'task': 'review'})), 'DENY')",
            "   check(f'{prefix}.allow', evaluate(call('Read', {'file_path': 'README.md'})), 'ALLOW')",
            "  elif policy_name == 'deny_shell':",
            "   evaluate = cel_policy(expression=arguments['expression'])",
            "   for tool in shell_tools: check(f'{prefix}.deny.{tool}', evaluate(call(tool, {'command': 'git status'})), 'DENY')",
            "   check(f'{prefix}.allow', evaluate(call('Read', {'file_path': 'README.md'})), 'ALLOW')",
            "  elif policy_name == 'block_orchestration_skills':",
            "   evaluate = block_skills(blocked=arguments['blocked'])",
            "   for skill in arguments['blocked']: check(f'{prefix}.deny.{skill}', evaluate(call('Skill', {'skill': skill})), 'DENY')",
            "   check(f'{prefix}.allow', evaluate(call('Skill', {'skill': 'not-a-project-skill'})), 'ALLOW')",
            "  elif policy_name == 'read_only_os':",
            "   evaluate = read_only_os(**arguments)",
            "   for tool in write_tools: check(f'{prefix}.deny.{tool}', evaluate(call(tool, {'file_path': 'src/x.ts'}), {}), 'DENY')",
            "   check(f'{prefix}.allow', evaluate(call('Read', {'file_path': 'README.md'}), {}), 'ALLOW')",
            "  elif policy_name == 'blast_radius':",
            "   evaluate = blast_radius(**arguments)",
            "   check(f'{prefix}.force_push', evaluate(call('Bash', {'command': 'git push --force origin HEAD:main'}), {}), 'DENY')",
            "   check(f'{prefix}.push', evaluate(call('Bash', {'command': 'git push origin feat/267'}), {}), 'ASK' if arguments.get('gate_pushes', True) else 'ALLOW')",
            "   check(f'{prefix}.allow', evaluate(call('Bash', {'command': 'git status'}), {}), 'ALLOW')",
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
    },
  );

  runtimePolicyTest("executes the explicit Fable safeguard branch", { timeout: 30_000 }, () => {
    const source = omnigentSource();
    expect(source, "OMNIGENT_SOURCE_ROOT must point to the pinned Omnigent checkout").toBeDefined();
    expect(source?.revision).toBe(omnigentRevision);
    const sourceRoot = source?.root as string;
    const orchestrator = readYaml<OrchestratorConfig>(".omnigent/polly-loopworks/config.yaml");
    const expression = policyExpression(policies(orchestrator).deny_claude_fable_5);
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
          "expression = json.loads(sys.argv[1])",
          "def call(name, arguments):",
          " return {'type': 'tool_call', 'data': {'name': name, 'arguments': arguments}}",
          "evaluate = cel_policy(expression=expression)",
          "checks = {",
          " 'fable': evaluate(call('sys_session_send', {'args': {'model': 'claude-fable-5'}})),",
          " 'declared': evaluate(call('sys_session_send', {'args': {'model': 'gpt-5.6-sol'}})),",
          " 'custom_child': evaluate(call('sys_session_create', {'config_path': 'custom.yaml'})),",
          "}",
          "expected = {'fable': 'DENY', 'declared': 'ALLOW', 'custom_child': 'DENY'}",
          "bad = {name: {'expected': expected[name], 'actual': result} for name, result in checks.items() if not result or result.get('result') != expected[name]}",
          "print(json.dumps({'checks': checks, 'bad': bad}, sort_keys=True))",
          "raise SystemExit(1 if bad else 0)",
        ].join("\n"),
        JSON.stringify(expression),
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
    const blockedSkills = readdirSync(path.join(repoRoot, ".agents/skills"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
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
          arguments: { blocked: expect.arrayContaining(blockedSkills) },
        },
      });
      const configuredBlocked = workerPolicies.block_orchestration_skills?.function?.arguments
        ?.blocked as string[] | undefined;
      expect(configuredBlocked).toEqual(blockedSkills);
      expect(workerPolicies.deny_nested_agents?.function?.path).toBe(handlers.cel);
      const expression = policyExpression(workerPolicies.deny_nested_agents);
      for (const nestedTool of ["spawn_agent", "Agent", "Task"]) {
        expect(expression).toContain(`"${nestedTool}"`);
      }
    }
  });

  runtimePolicyTest(
    "uses public policy paths that resolve through real Python imports",
    { timeout: 30_000 },
    () => {
      const source = omnigentSource();
      expect(
        source,
        "OMNIGENT_SOURCE_ROOT must point to the pinned Omnigent checkout",
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

      expect(configuredPaths.every((handler) => handler.startsWith("omnigent.policies."))).toBe(
        true,
      );
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
    },
  );

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
    const skill = readFileSync(orchestrationSkillPath, "utf8");
    expect(skill).toContain("name: orchestrate-issue-pr");
    expect(skill).toContain("Single PR only");
    expect(skill).not.toMatch(/stacked PR|gh-stack/i);
    for (const field of ["ROLE:", "PHASE:", "DONE:", "YOU PRODUCE:", "YOU DO NOT:", "NEXT:"]) {
      expect(skill).toContain(field);
    }
    expect(skill).toContain("Every `args.input` must begin");
    expect(skill).toContain(".polly/workflow-state.md");
    expect(skill).toContain("append after every phase transition");
  });

  it("bounds review reconciliation, preserves an independence floor, and publishes evidence", () => {
    const skill = readFileSync(orchestrationSkillPath, "utf8");
    const orchestrator = readYaml<OrchestratorConfig>(".omnigent/polly-loopworks/config.yaml");
    const prompt = orchestrator.prompt ?? "";

    for (const text of [skill, prompt]) {
      const normalized = text.toLowerCase();
      expect(normalized).toContain("two reconciliation rounds");
      expect(normalized).toContain("human operator");
      expect(normalized).toContain("publication remains blocked");
      expect(normalized).toContain("both reviewers share the author's model lineage");
      expect(normalized).toContain("explicit operator authorization");
      expect(text).not.toContain("Terra model override");
      expect(text).toContain("`ask`");
    }

    expect(skill).toContain(".polly/review-packet/reviewer-a.md");
    expect(skill).toContain(".polly/review-packet/reviewer-b.md");
    expect(skill).toContain("gh pr comment --body-file");
    expect(skill).toContain("comment URL");
  });

  it("records the self-attested cwd residual risk and unique ADR numbering", () => {
    const adr = readFileSync(
      path.join(repoRoot, "docs/adr/0034-project-scoped-polly-model-routing.md"),
      "utf8",
    );
    expect(adr).toContain("self-attested");
    expect(adr).toContain("allow_cwd_override: true");
    expect(adr).toContain("gate_pushes: false");

    const adrFiles = readdirSync(path.join(repoRoot, "docs/adr"));
    expect(adrFiles.filter((name) => name.startsWith("0034-"))).toEqual([
      "0034-project-scoped-polly-model-routing.md",
    ]);
    expect(adrFiles).not.toContain("0033-project-scoped-polly-model-routing.md");
  });

  it("splits phase craft from the thin human-facing composers", () => {
    const skillText = new Map(
      phaseSkillNames.map((name) => [
        name,
        readFileSync(path.join(repoRoot, `.agents/skills/${name}/SKILL.md`), "utf8"),
      ]),
    );
    for (const [name, skill] of skillText) {
      const bundleSkillPath = path.join(bundleRoot, `skills/${name}`);
      expect(readlinkSync(bundleSkillPath)).toBe(`../../../.agents/skills/${name}`);
      expect(statSync(path.join(bundleSkillPath, "SKILL.md")).isFile()).toBe(true);
      expect(readFileSync(path.join(bundleSkillPath, "SKILL.md"), "utf8")).toBe(skill);
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
