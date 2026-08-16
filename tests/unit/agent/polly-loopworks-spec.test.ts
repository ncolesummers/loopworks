import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";

const repoRoot = process.cwd();
const bundleRoot = path.join(repoRoot, ".omnigent/polly-loopworks");
const bundleManifestPath = path.join(bundleRoot, ".claude-plugin/plugin.json");
const orchestrationSkillPath = path.join(bundleRoot, "skills/orchestrate-issue-pr/SKILL.md");
const phaseSkillNames = ["browser-validate", "commit-signed-pr", "tdd-implement"];
const omnigentRevision = "ba241c3592000b8098101164d3de03d52ca74ddf";
const issue280Url = "https://github.com/ncolesummers/loopworks/issues/280";

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
  readOnly: "omnigent.policies.builtins.orchestration.read_only_os",
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
  name?: string;
  skills?: string | string[];
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

type SkillClassification = "CRAFT" | "ORCHESTRATION";

type SkillFrontmatter = {
  name?: string;
  metadata?: { "loopworks-skill-class"?: string };
};

type SkillPolicyManifest = {
  name?: string;
  metadata?: {
    loopworks?: {
      version?: number;
      skillClassifications?: Record<string, SkillClassification>;
      orchestrationBlocklist?: string[];
    };
  };
};

type DiscoveredSkill = {
  name: string;
  path: string;
};

const expectedSkillClassifications: Record<string, SkillClassification> = {
  "agent-browser": "CRAFT",
  "browser-validate": "CRAFT",
  "commit-signed-pr": "CRAFT",
  eve: "CRAFT",
  "gh-stack": "CRAFT",
  "implement-issue": "ORCHESTRATION",
  "implement-issue-pr": "ORCHESTRATION",
  "polly-loopworks:browser-validate": "CRAFT",
  "polly-loopworks:commit-signed-pr": "CRAFT",
  "polly-loopworks:orchestrate-issue-pr": "ORCHESTRATION",
  "polly-loopworks:tdd-implement": "CRAFT",
  "tdd-implement": "CRAFT",
};

const expectedOrchestrationBlocklist = [
  "implement-issue",
  "implement-issue-pr",
  "orchestrate-issue-pr",
  "polly-loopworks:orchestrate-issue-pr",
].sort();

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

function skillDirectories(root: string): string[] {
  return readdirSync(root)
    .map((name) => path.join(root, name))
    .filter((candidate) => statSync(candidate).isDirectory())
    .filter((candidate) => existsSync(path.join(candidate, "SKILL.md")));
}

function skillFrontmatter(skillDirectory: string): SkillFrontmatter {
  const skillPath = path.join(skillDirectory, "SKILL.md");
  const match = readFileSync(skillPath, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  expect(match, `${skillPath} must begin with YAML frontmatter`).not.toBeNull();
  return parse(match?.[1] ?? "") as SkillFrontmatter;
}

function discoveredSkillIdentities(roots: string[]): DiscoveredSkill[] {
  const discovered = roots.flatMap((root) =>
    skillDirectories(root).map((skillDirectory) => {
      const frontmatter = skillFrontmatter(skillDirectory);
      expect(frontmatter.name, `${skillDirectory} must declare its resolved skill name`).toMatch(
        /^[a-z0-9-]+$/,
      );
      if (path.basename(skillDirectory) !== frontmatter.name) {
        throw new Error(
          `${skillDirectory} basename must match frontmatter name ${String(frontmatter.name)}`,
        );
      }
      return {
        name: frontmatter.name as string,
        path: skillDirectory,
      };
    }),
  );
  const names = discovered.map((skill) => skill.name);
  if (new Set(names).size !== names.length) {
    throw new Error(`duplicate resolved name: ${names.join(", ")}`);
  }
  return discovered.sort((a, b) => a.name.localeCompare(b.name));
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

function readSkillPolicyManifest(): SkillPolicyManifest {
  expect(existsSync(bundleManifestPath), `${bundleManifestPath} must exist`).toBe(true);
  return JSON.parse(readFileSync(bundleManifestPath, "utf8")) as SkillPolicyManifest;
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

  it("declares exactly the six role-named workers", () => {
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
      expect(text).toContain("every codex-native worker");
      expect(text).toContain("implementers");
      for (const name of ["sol", "luna", "terra", "reviewer_sol"]) {
        expect(text).toContain(`\`${name}\``);
      }
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
      expect(expression).toContain("pr");
      expect(expression).toContain("api");
      expect(expression).toContain("pulls");
      expect(expression).toContain("mergePullRequest");
      expect(expression).toContain('"sys_os_shell"');
      expect(expression).toContain('"DENY"');
    }
    expect(policies(actorConfigs[0]).blast_radius?.function?.arguments?.gate_pushes).toBe(true);

    for (const relativePath of [
      ".omnigent/polly-loopworks/ROUTING.md",
      "docs/adr/0034-project-scoped-polly-model-routing.md",
    ]) {
      const text = readFileSync(path.join(repoRoot, relativePath), "utf8");
      const normalized = text.replace(/\s+/g, " ");
      expect(normalized).toContain("best-effort speed bump");
      expect(normalized).toContain("branch protection");
      expect(normalized).toContain("token without merge scope");
      expect(normalized).toContain("out of scope");
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
            "merge_commands = ['gh pr merge 268 --squash', 'gh -R owner/repo pr merge 268', 'gh --repo=owner/repo pr merge 268', 'gh pr --repo owner/repo merge 268', 'gh pr -R owner/repo merge 268', 'gh -Rowner/repo pr merge 268', 'gh api -X PUT repos/owner/repo/pulls/268/merge', 'gh api graphql -f query=mutation{mergePullRequest(input:{pullRequestId:1}){pullRequest{id}}}']",
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
            "   for tool in ['Bash', 'sys_os_shell']:",
            "    for index, shell_command in enumerate(merge_commands): check(f'{prefix}.{tool}.deny.{index}', evaluate(call(tool, {'command': shell_command})), 'DENY')",
            "    check(f'{prefix}.{tool}.allow', evaluate(call(tool, {'command': 'git status'})), 'ALLOW')",
            "  elif policy_name == 'deny_nested_agents':",
            "   evaluate = cel_policy(expression=arguments['expression'])",
            "   for tool in nested_tools:",
            "    expected = 'ALLOW' if actor == 'orchestrator' and tool == 'sys_session_send' else 'DENY'",
            "    check(f'{prefix}.deny.{tool}', evaluate(call(tool, {'task': 'review'})), expected)",
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

  it("owns the exact skill policy in one repo-owned bundle manifest", () => {
    const manifest = readSkillPolicyManifest();
    const policy = manifest.metadata?.loopworks;
    expect(manifest.name).toBe("polly-loopworks");
    expect(policy?.version).toBe(1);
    expect(
      policy?.skillClassifications,
      "classification changed - this is a policy change",
    ).toEqual(expectedSkillClassifications);
    expect(
      [...(policy?.orchestrationBlocklist ?? [])].sort(),
      "the runtime blocklist is explicit and must not be derived from classification",
    ).toEqual(expectedOrchestrationBlocklist);

    for (const root of [path.join(repoRoot, ".agents/skills"), path.join(bundleRoot, "skills")]) {
      for (const skillDirectory of skillDirectories(root)) {
        expect(
          skillFrontmatter(skillDirectory).metadata?.["loopworks-skill-class"],
          `${skillDirectory} must not own policy classification`,
        ).toBeUndefined();
      }
    }
  });

  it("fails closed when any resolved project or bundle skill is unclassified", () => {
    const classifications =
      readSkillPolicyManifest().metadata?.loopworks?.skillClassifications ?? {};
    const projectSkills = discoveredSkillIdentities([path.join(repoRoot, ".agents/skills")]);
    const bundleSkills = discoveredSkillIdentities([path.join(bundleRoot, "skills")]);
    const discovered = [
      ...projectSkills.map((skill) => skill.name),
      ...bundleSkills.map((skill) => `polly-loopworks:${skill.name}`),
    ];
    expect(new Set(discovered).size, "resolved skill names must be unique").toBe(discovered.length);
    expect(
      Object.keys(classifications).sort(),
      "an unclassified skill is a policy failure",
    ).toEqual([...discovered].sort());
  });

  it("rejects duplicate resolved names and basename/frontmatter mismatches", () => {
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "loopworks-skill-identity-"));
    const firstRoot = path.join(fixtureRoot, "first");
    const secondRoot = path.join(fixtureRoot, "second");
    const writeSkill = (root: string, directoryName: string, frontmatterName: string) => {
      const directory = path.join(root, directoryName);
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        path.join(directory, "SKILL.md"),
        `---\nname: ${frontmatterName}\ndescription: fixture\n---\n`,
      );
    };

    try {
      writeSkill(firstRoot, "tdd-implement", "tdd-implement");
      writeSkill(secondRoot, "tdd-implement", "tdd-implement");
      expect(() => discoveredSkillIdentities([firstRoot, secondRoot])).toThrow(
        /duplicate resolved name/i,
      );

      rmSync(secondRoot, { recursive: true, force: true });
      writeSkill(secondRoot, "renamed-tdd", "tdd-implement");
      expect(() => discoveredSkillIdentities([secondRoot])).toThrow(/basename.*frontmatter/i);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("configures named-agent denials and blocks orchestration but never craft skills", () => {
    const craftNames = Object.entries(expectedSkillClassifications)
      .filter(([, classification]) => classification === "CRAFT")
      .map(([name]) => name);
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
          arguments: { blocked: expectedOrchestrationBlocklist },
        },
      });
      const configuredBlocked = workerPolicies.block_orchestration_skills?.function?.arguments
        ?.blocked as string[] | undefined;
      for (const craft of craftNames) {
        expect(configuredBlocked).not.toContain(craft);
      }
      expect(workerPolicies.deny_nested_agents?.function?.path).toBe(handlers.cel);
      const expression = policyExpression(workerPolicies.deny_nested_agents);
      for (const nestedTool of ["spawn_agent", "Agent", "Task"]) {
        expect(expression).toContain(`"${nestedTool}"`);
      }
    }
  });

  it("makes host skills hermetic and blocks orchestration plus named child tools", () => {
    const orchestrator = readYaml<OrchestratorConfig>(".omnigent/polly-loopworks/config.yaml");
    const orchestratorPolicies = policies(orchestrator);
    expect(orchestrator.name).toBe("polly-loopworks");
    expect(orchestrator.skills).toBe("none");
    expect(orchestratorPolicies.block_orchestration_skills).toMatchObject({
      function: {
        path: handlers.blockSkills,
        arguments: { blocked: expectedOrchestrationBlocklist },
      },
    });
    expect(orchestratorPolicies.deny_nested_agents?.function?.path).toBe(handlers.cel);
    const expression = policyExpression(orchestratorPolicies.deny_nested_agents);
    for (const nestedTool of ["spawn_agent", "Agent", "Task", "TaskCreate", "sys_session_create"]) {
      expect(expression).toContain(`"${nestedTool}"`);
    }
    expect(expression).not.toContain('"sys_session_send"');
  });

  runtimePolicyTest(
    "executes resolver-derived bundle Skill calls against every blocklist",
    { timeout: 30_000 },
    () => {
      const source = omnigentSource();
      expect(
        source,
        "OMNIGENT_SOURCE_ROOT must point to the pinned Omnigent checkout",
      ).toBeDefined();
      expect(source?.revision).toBe(omnigentRevision);
      const sourceRoot = source?.root as string;
      const orchestrator = readYaml<OrchestratorConfig>(".omnigent/polly-loopworks/config.yaml");
      const actorPolicies = {
        "polly-loopworks": policies(orchestrator).block_orchestration_skills,
        ...Object.fromEntries(
          Object.keys(expectedWorkers).map((name) => [
            name,
            policies(readAgent(name as keyof typeof expectedWorkers)).block_orchestration_skills,
          ]),
        ),
      };
      const payload = {
        actorPolicies,
        bundleRoot,
      };
      const importPython = process.env.OMNIGENT_IMPORT_PYTHON;
      const command = importPython ?? "uv";
      const commandPrefix = importPython
        ? []
        : ["run", "--with", "pydantic>=2,<3", "--with", "pyyaml>=6,<7", "--no-project", "python"];
      const probe = spawnSync(
        command,
        [
          ...commandPrefix,
          "-c",
          [
            "import json, shutil, sys, tempfile",
            "from pathlib import Path",
            "from omnigent.inner.bundle_skills import ensure_bundle_plugin_manifest",
            "from omnigent.policies.builtins.safety import block_skills",
            "from omnigent.spec.skill_sources import SkillSourceContext, resolve_harness_skills",
            "payload = json.loads(sys.argv[1])",
            "def load(skill):",
            " return {'type': 'tool_call', 'data': {'name': 'Skill', 'arguments': {'skill': skill}}}",
            "checks = {}",
            "bad = {}",
            "with tempfile.TemporaryDirectory() as tmp:",
            " home = Path(tmp) / 'home'",
            " install = home / '.claude/plugins/cache/loopworks/polly-loopworks/1.0.0'",
            " shutil.copytree(Path(payload['bundleRoot']), install)",
            " ensure_bundle_plugin_manifest(install, 'polly-loopworks')",
            " ensure_bundle_plugin_manifest(install, 'opus')",
            " manifest = json.loads((install / '.claude-plugin/plugin.json').read_text())",
            " plugin = manifest['name']",
            " key = f'{plugin}@loopworks'",
            " (home / '.claude').mkdir(parents=True, exist_ok=True)",
            " (home / '.claude/settings.json').write_text(json.dumps({'enabledPlugins': {key: True}}))",
            " (home / '.claude/plugins/installed_plugins.json').write_text(json.dumps({'version': 2, 'plugins': {key: [{'scope': 'user', 'installPath': str(install), 'version': '1.0.0'}]}}))",
            " ctx = SkillSourceContext(roots=(), home=home, skills_filter='all', bundle_dir=install)",
            " resolved = [skill.name for skill in resolve_harness_skills(ctx, 'claude-native')]",
            " orchestration = [name for name in resolved if name.endswith(':orchestrate-issue-pr')]",
            " craft = [name for name in resolved if name.endswith(':tdd-implement')]",
            " if orchestration != ['polly-loopworks:orchestrate-issue-pr']: bad['resolver.orchestration'] = {'expected': ['polly-loopworks:orchestrate-issue-pr'], 'actual': orchestration}",
            " if craft != ['polly-loopworks:tdd-implement']: bad['resolver.craft'] = {'expected': ['polly-loopworks:tdd-implement'], 'actual': craft}",
            " for actor, policy in payload['actorPolicies'].items():",
            "  blocked = policy['function']['arguments']['blocked']",
            "  evaluate = block_skills(blocked=blocked)",
            "  for shape in ['orchestrate-issue-pr', *orchestration]:",
            "   label = f'{actor}.orchestration.{shape}'",
            "   result = evaluate(load(shape))",
            "   checks[label] = result",
            "   if result.get('result') != 'DENY': bad[label] = {'expected': 'DENY', 'actual': result}",
            "  for shape in ['tdd-implement', *craft]:",
            "   label = f'{actor}.craft.{shape}'",
            "   result = evaluate(load(shape))",
            "   checks[label] = result",
            "   if result.get('result') != 'ALLOW': bad[label] = {'expected': 'ALLOW', 'actual': result}",
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

  it("configures the Fable override and custom-child safeguard", () => {
    const orchestrator = readYaml<OrchestratorConfig>(".omnigent/polly-loopworks/config.yaml");
    const orchestratorPolicies = policies(orchestrator);
    const expression = policyExpression(orchestratorPolicies.deny_claude_fable_5);
    expect(expression).toContain('event.data.name == "sys_session_create"');
    expect(expression).toContain("claude-fable-5");
  });

  it("defers workflow guarantees to issue 280 and keeps only routing behavior", () => {
    const skill = readFileSync(orchestrationSkillPath, "utf8");
    const orchestrator = readYaml<OrchestratorConfig>(".omnigent/polly-loopworks/config.yaml");
    const prompt = orchestrator.prompt ?? "";
    const routing = readFileSync(path.join(bundleRoot, "ROUTING.md"), "utf8");
    const adr = readFileSync(
      path.join(repoRoot, "docs/adr/0034-project-scoped-polly-model-routing.md"),
      "utf8",
    );
    const orchestratorYaml = readFileSync(path.join(bundleRoot, "config.yaml"), "utf8");

    for (const text of [skill, prompt, routing, adr, orchestratorYaml]) {
      expect(text).toContain(issue280Url);
    }

    const scopedClaims = [
      ...[skill, prompt, routing, adr, orchestratorYaml],
      ...Object.keys(expectedWorkers).map((name) =>
        readFileSync(path.join(bundleRoot, `agents/${name}/config.yaml`), "utf8"),
      ),
    ];
    for (const text of scopedClaims) {
      const normalized = text.toLowerCase().replace(/\s+/g, " ");
      for (const strippedClaim of [
        "same-finding",
        "same finding",
        "divergence means",
        "without a separate round cap",
        "neither reviewer",
        "each sees only",
        "never sees the other",
        "only the declared worker roster",
        "never authors a commit",
        "you never implement",
        "every `args.input` must begin",
        "record a chronological entry after every phase transition",
        "append your completion evidence",
        "before dispatch, bootstrap",
      ]) {
        expect(normalized).not.toContain(strippedClaim);
      }
    }

    expect(routing).toContain("bun install");
    expect(routing).toContain(".env.local");
    expect(routing).toContain("security:osv");
    expect(routing.toLowerCase()).toContain("convention");
    expect(routing.toLowerCase().replace(/\s+/g, " ")).toContain("not enforced");
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

  it("keeps bundle craft sequence-free without rewriting the human-facing composers", () => {
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
      expect(composer).not.toContain("## Managed mode");
      expect(composer).not.toContain(".polly/workflow-state.md");
      expect(composer).not.toContain(".polly/review-packet");
    }
    expect(implementIssuePr).toContain("git commit -S");
    expect(implementIssue).not.toContain("gh pr create");
  });

  it("pins the shared TDD craft contract used by human and managed workflows", () => {
    const tdd = readFileSync(path.join(repoRoot, ".agents/skills/tdd-implement/SKILL.md"), "utf8");
    const normalized = tdd.replace(/\s+/g, " ");
    for (const contract of [
      "Map every acceptance criterion",
      "negative and boundary cases",
      "tests before implementation",
      "exact focused command",
      "not red evidence",
      "smallest production, configuration, or documentation change",
      "AC-to-test map",
      "exact red command",
      "exact green command",
      "requested handoff packet",
    ]) {
      expect(normalized).toContain(contract);
    }
  });

  it("documents conditional runtime probes without claiming unenforced ledger or header state", () => {
    const adr = readFileSync(
      path.join(repoRoot, "docs/adr/0034-project-scoped-polly-model-routing.md"),
      "utf8",
    );
    const routing = readFileSync(path.join(bundleRoot, "ROUTING.md"), "utf8");
    const orchestrator = readFileSync(path.join(bundleRoot, "config.yaml"), "utf8");
    const skill = readFileSync(orchestrationSkillPath, "utf8");
    expect(adr).toContain("OMNIGENT_SOURCE_ROOT");
    expect(adr.toLowerCase()).toContain("skipped");
    for (const text of [adr, routing, orchestrator, skill]) {
      expect(text).not.toContain("append-only");
      expect(text).not.toContain("never overwrite");
      expect(text).not.toContain("every dispatch carries");
      expect(text).not.toContain("only phase-scoped craft skills");
      expect(text).not.toContain("phase-scoped craft only");
    }
  });

  it("protects ignored Polly scratch from cleanup and Markdownlint", () => {
    const gitignore = readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
    expect(gitignore).toContain(".polly/");
    expect(gitignore).toContain("agents must not delete");
    const markdownlint = readYaml<MarkdownlintConfig>(".markdownlint-cli2.yaml");
    expect(markdownlint.ignores).toContain(".polly");
  });
});
