import {
  type LoopManifest,
  type LoopState,
  loopManifestSchema,
  loopStateValues,
  retryableStatusValues,
} from "../../../schemas/loop-manifest";

export type LoopManifestValidationError = {
  path: string;
  message: string;
  hint: string;
};

export type LoopManifestValidationResult =
  | {
      success: true;
      data: LoopManifest;
    }
  | {
      success: false;
      errors: LoopManifestValidationError[];
    };

export const defaultLoopManifest: LoopManifest = loopManifestSchema.parse({
  version: 1,
  repo: "ncolesummers/loopworks",
  note: "Loopworks operating contract and bootstrap planning manifest.",
  loops: [
    {
      key: "development-loop",
      name: "Agent-ready development loop",
      description:
        "Routes agent-ready GitHub issues through planning, implementation, validation, review, and PR preparation gates.",
      enabled: true,
      repoScope: {
        repositories: ["ncolesummers/loopworks"],
        branchPatterns: ["main", "codex/*"],
        includeForks: false,
      },
      triggers: {
        issueLabels: ["agent-ready"],
        blockedLabels: ["status:blocked"],
        issueStates: ["opened", "reopened", "labeled"],
        manual: true,
        schedule: {
          enabled: false,
          timezone: "UTC",
        },
      },
      modelPolicy: {
        defaultModel: "codex-default",
      },
      toolPolicy: {
        allowedToolCategories: ["repo-read", "repo-write", "github", "validation"],
        externalWritesRequireApproval: true,
      },
      budgets: {
        maxRunMinutes: 90,
        maxModelUsd: 25,
        maxToolCalls: 120,
      },
      approvals: {
        requiredFor: ["external_write", "pr_creation", "manifest_rollout"],
        bypassPolicy: "none",
        gates: [
          {
            key: "plan-review",
            name: "Plan review",
            required: true,
            reviewers: ["maintainer"],
            evidence: ["plan"],
          },
          {
            key: "external-write-review",
            name: "External write review",
            required: true,
            reviewers: ["maintainer"],
            evidence: ["diff_summary", "validation_report"],
          },
        ],
      },
      artifacts: [
        {
          type: "plan",
          required: true,
          description:
            "Issue-backed execution plan with acceptance criteria and validation mapping.",
          retention: "pr",
        },
        {
          type: "validation_report",
          required: true,
          description: "Deterministic command evidence collected before review or rollout.",
          retention: "audit",
        },
        {
          type: "screenshot",
          required: true,
          description:
            "Validation-owned responsive screenshot manifest, explicit and empty for non-UI runs.",
          retention: "audit",
        },
        {
          type: "test_plan",
          required: true,
          description:
            "AC-mapped automated test plan with explicit fixtures and a bounded test-only patch.",
          retention: "audit",
        },
        {
          type: "diff_summary",
          required: true,
          description: "Human-readable summary of proposed source changes.",
          retention: "pr",
        },
        {
          type: "pr_intent",
          required: true,
          description: "Draft PR metadata prepared after validation and approval gates pass.",
          retention: "pr",
        },
      ],
      validationGates: [
        {
          key: "focused-tests",
          name: "Focused manifest tests",
          command: "bun test tests/unit/loops/manifest.test.ts",
          required: true,
          phase: "before_implementation",
          produces: "validation_report",
        },
        {
          key: "aggregate-validation",
          name: "Aggregate validation",
          command: "bun run validate",
          required: true,
          phase: "before_rollout",
          produces: "validation_report",
        },
      ],
      retryPolicy: {
        maxAttempts: 2,
        retryableStatuses: [...retryableStatusValues],
        backoff: {
          strategy: "exponential",
          initialSeconds: 30,
          maxSeconds: 300,
        },
      },
      concurrency: {
        group: "repo:{repo}:loop:development",
        maxInFlight: 1,
        cancelInProgress: false,
      },
      cancellation: {
        onSuperseded: "mark_canceled",
        onDisabled: "skip_new_runs",
        requiresReason: true,
      },
      githubWriteback: {
        enabled: true,
        channels: ["issue_comment"],
        requireApprovalForLabels: true,
      },
    },
    {
      key: "research-loop",
      name: "Research loop",
      description:
        "Routes spike and agent-ready issues through fixture-backed planning, research, authoring, and completion contracts.",
      enabled: true,
      repoScope: {
        repositories: ["ncolesummers/loopworks"],
        branchPatterns: ["main", "codex/*"],
        includeForks: false,
      },
      triggers: {
        issueLabels: ["agent-ready", "spike"],
        blockedLabels: ["status:blocked"],
        issueStates: ["opened", "reopened", "labeled"],
        manual: false,
        schedule: { enabled: false, timezone: "UTC" },
      },
      modelPolicy: { defaultModel: "codex-default" },
      toolPolicy: {
        allowedToolCategories: ["repo-read", "browser", "validation"],
        externalWritesRequireApproval: true,
      },
      budgets: {
        maxRunMinutes: 90,
        maxModelUsd: 25,
        maxToolCalls: 120,
      },
      approvals: {
        requiredFor: ["manifest_rollout"],
        bypassPolicy: "none",
        gates: [
          {
            key: "manifest-review",
            name: "Manifest review",
            required: true,
            reviewers: ["maintainer"],
            evidence: ["plan"],
          },
        ],
      },
      artifacts: [
        {
          type: "plan",
          required: true,
          description: "Issue-backed research plan placeholder for the planning stage.",
          retention: "audit",
        },
        {
          type: "summary",
          required: true,
          description:
            "Indexed findings placeholders, one per subquestion from isolated child sessions.",
          retention: "audit",
        },
        {
          type: "summary",
          required: true,
          description: "Reviewable research document placeholder for the authoring stage.",
          retention: "audit",
        },
        {
          type: "summary",
          required: true,
          description: "Durable completion summary placeholder for the terminal stage.",
          retention: "run",
        },
      ],
      validationGates: [
        {
          key: "focused-research-tests",
          name: "Focused research loop tests",
          command: "bun run test -- tests/unit/loops/research-run.test.ts",
          required: true,
          phase: "before_implementation",
          produces: "validation_report",
        },
        {
          key: "aggregate-validation",
          name: "Aggregate validation",
          command: "bun run validate",
          required: true,
          phase: "before_rollout",
          produces: "validation_report",
        },
      ],
      retryPolicy: {
        maxAttempts: 2,
        retryableStatuses: [...retryableStatusValues],
        backoff: { strategy: "exponential", initialSeconds: 30, maxSeconds: 300 },
      },
      concurrency: {
        group: "repo:{repo}:loop:research",
        maxInFlight: 1,
        cancelInProgress: false,
      },
      cancellation: {
        onSuperseded: "mark_canceled",
        onDisabled: "skip_new_runs",
        requiresReason: true,
      },
      githubWriteback: {
        enabled: false,
        channels: [],
        requireApprovalForLabels: true,
      },
    },
  ],
  milestones: [
    {
      key: "M0",
      name: "M0 Project Foundation",
      description: "Repo and local development baseline.",
      personaTestIds: ["P01", "P03", "R02", "S04"],
      issues: [
        {
          title: "Project foundation and repo contract",
          labels: ["kind:epic", "milestone:M0", "area:docs"],
          template: "epic.yml",
          personaTestIds: ["P03", "R02"],
        },
        {
          title: "Bootstrap app shell and local development",
          labels: ["kind:task", "milestone:M0", "area:app-shell"],
          template: "task.yml",
          personaTestIds: ["P01", "R02", "S04"],
        },
      ],
    },
    {
      key: "M1",
      name: "M1 Design System Direction + App Shell",
      description: "Early design direction and reusable shell primitives.",
      personaTestIds: ["P01", "P04", "M01", "A02", "R02"],
      issues: [
        {
          title: "Design system direction and tokens",
          labels: ["kind:design", "milestone:M1", "area:design-system"],
          template: "design-system.yml",
          personaTestIds: ["P04", "R02"],
        },
        {
          title: "App shell navigation and layout",
          labels: ["kind:task", "milestone:M1", "area:app-shell"],
          template: "task.yml",
          personaTestIds: ["P01", "P04", "M01", "A02"],
        },
      ],
    },
    {
      key: "M2",
      name: "M2 GitHub + Vercel Source Systems",
      description: "Connect the external sources of truth.",
      personaTestIds: ["P02", "M01", "M03", "R01", "S01", "S02", "S03"],
      issues: [
        {
          title: "GitHub issue ingestion and sync",
          labels: ["kind:feature", "milestone:M2", "area:github", "status:ready"],
          template: "feature.yml",
          personaTestIds: ["P02", "S01", "S02", "S03"],
        },
        {
          title: "Vercel deployment and preview summaries",
          labels: ["kind:feature", "milestone:M2", "area:vercel", "status:ready"],
          template: "feature.yml",
          personaTestIds: ["M01", "M03", "R01"],
        },
      ],
    },
    {
      key: "M3",
      name: "M3 Durable Loop MVP",
      description: "Persisted loop model and timeline.",
      personaTestIds: ["M02", "A01", "A02", "A03", "R01"],
      issues: [
        {
          title: "Durable loop event model",
          labels: ["kind:feature", "milestone:M3", "area:loop"],
          template: "feature.yml",
          personaTestIds: ["M02", "A01", "A03"],
        },
        {
          title: "Loop timeline and status transitions",
          labels: ["kind:feature", "milestone:M3", "area:loop"],
          template: "feature.yml",
          personaTestIds: ["A01", "A02", "R01"],
        },
      ],
    },
    {
      key: "M4",
      name: "M4 Validation + PR Path + MVP Security Review",
      description: "Release confidence and security gate.",
      personaTestIds: ["A03", "R01", "R02", "S01", "S02", "S03", "S04"],
      issues: [
        {
          title: "Validation and PR checkpoint views",
          labels: ["kind:feature", "milestone:M4", "area:pr-flow"],
          template: "feature.yml",
          personaTestIds: ["A03", "R01", "R02"],
        },
        {
          title: "MVP security review",
          labels: ["kind:security", "milestone:M4", "priority:p0"],
          template: "security-review.yml",
          personaTestIds: ["S01", "S02", "S03", "S04"],
        },
      ],
    },
    {
      key: "M5",
      name: "M5 Agent Governance + Evals",
      description: "Policy, approvals, and eval coverage.",
      personaTestIds: ["P03", "A02", "A03", "R02", "S04"],
      issues: [
        {
          title: "Agent governance rules and approval boundaries",
          labels: ["kind:feature", "milestone:M5", "area:agent"],
          template: "feature.yml",
          personaTestIds: ["P03", "A02", "S04"],
        },
        {
          title: "Agent eval harness and scenario coverage",
          labels: ["kind:feature", "milestone:M5", "area:evals"],
          template: "feature.yml",
          personaTestIds: ["A03", "R02"],
        },
      ],
    },
  ],
  labels: [
    { name: "kind:epic", category: "kind" },
    { name: "kind:feature", category: "kind" },
    { name: "kind:task", category: "kind" },
    { name: "kind:bug", category: "kind" },
    { name: "kind:design", category: "kind" },
    { name: "kind:security", category: "kind" },
    {
      name: "agent-ready",
      category: "custom",
      description: "Issue can trigger the development loop.",
    },
    {
      name: "needs-approval",
      category: "custom",
      description: "Human approval is required before advancing.",
    },
    { name: "priority:p0", category: "priority", required: true },
    { name: "priority:p1", category: "priority", required: true },
    { name: "priority:p2", category: "priority", required: true },
    { name: "priority:p3", category: "priority", required: true },
    { name: "area:docs", category: "area", required: true },
    { name: "area:app-shell", category: "area", required: true },
    { name: "area:design-system", category: "area", required: true },
    { name: "area:github", category: "area", required: true },
    { name: "area:vercel", category: "area", required: true },
    { name: "area:loop", category: "area", required: true },
    { name: "area:pr-flow", category: "area", required: true },
    { name: "area:agent", category: "area", required: true },
    { name: "area:evals", category: "area", required: true },
    { name: "status:blocked", category: "status" },
    { name: "status:ready", category: "status" },
    { name: "status:in-progress", category: "status" },
    { name: "status:review", category: "status" },
  ],
});

export function parseLoopManifest(input: unknown): LoopManifest {
  return loopManifestSchema.parse(input);
}

export function validateLoopManifest(input: unknown): LoopManifestValidationResult {
  const result = loopManifestSchema.safeParse(input);

  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }

  return {
    success: false,
    errors: result.error.issues.map((issue) => {
      const path = formatManifestPath(issue.path);

      return {
        path,
        message: issue.message,
        hint: getManifestValidationHint(path),
      };
    }),
  };
}

export function isLoopState(value: string): value is LoopState {
  return loopStateValues.includes(value as LoopState);
}

function formatManifestPath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) {
    return "manifest";
  }

  return path.reduce<string>((formattedPath, pathPart) => {
    if (typeof pathPart === "number") {
      return `${formattedPath}[${pathPart}]`;
    }

    const property = String(pathPart);
    if (/^[A-Za-z_$][\w$]*$/.test(property)) {
      return formattedPath === "" ? property : `${formattedPath}.${property}`;
    }

    return `${formattedPath}[${JSON.stringify(property)}]`;
  }, "");
}

function getManifestValidationHint(path: string): string {
  if (path === "version") {
    return "Set version to 1 for the current loop manifest contract.";
  }

  if (path === "repo" || path.includes(".repositories")) {
    return "Use an owner/repo slug such as ncolesummers/loopworks.";
  }

  if (path.includes("loops")) {
    if (path.includes("triggers.issueLabels")) {
      return "Add at least one GitHub label that can trigger the loop, such as agent-ready.";
    }

    if (path.includes("validationGates")) {
      return "Define at least one validation gate with a key, command, and required flag.";
    }

    if (path.includes("approvals")) {
      return "Define approval gates with reviewers and required evidence for high-impact actions.";
    }

    if (path.includes("retryPolicy")) {
      return "Set retry maxAttempts to at least 1 and provide a bounded backoff policy.";
    }

    if (path.includes("concurrency")) {
      return "Set a concurrency group and maxInFlight of at least 1.";
    }

    if (path.includes("cancellation")) {
      return "Choose explicit cancellation behavior for superseded and disabled loop states.";
    }
  }

  return "Review the loop manifest contract and provide the missing or invalid field.";
}
