import type { PlanningAgentOutput } from "@agent/planning-agent";

/** Serializable representative review artifact; never a production fallback. */
export const approvalPlanFixture = {
  identity: {
    id: "plan:ncolesummers/loopworks#275",
    sha256: "299bfbbd6ec2291962c5e2a6d54086bba5457875128a68a2ade49ca67271e0bd",
  },
  summary:
    "Repair the approvals surface so an operator can understand the proposed work, inspect the evidence, and decide whether this exact plan should proceed to test writing. Preserve the existing decision transaction, attribution, duplicate protection, and recovery guidance while making long review content readable on a phone.",
  model: "openai/gpt-5.6-sol-xhigh",
  issue: {
    acceptanceCriteria: [
      "Review the proposed steps, validation and risks before deciding.",
      "Preserve exact-plan approval and evidence after a decision.",
    ],
    labels: ["enhancement"],
    milestone: "M5",
    number: 275,
    repositoryFullName: "ncolesummers/loopworks",
    title: "Make approval decisions understandable and attributable",
    url: "https://github.com/ncolesummers/loopworks/issues/275",
  },
  repositoryRevision: {
    ref: "agent/275-approval-gates-surface",
    commitSha: "18c2e4bbe402a466972901cdc94e335df353ccff",
  },
  initialState: "planned",
  checkpoints: ["Plan recorded", "Validation scoped"],
  stages: [
    {
      key: "test-writing",
      title: "Write acceptance tests",
      owner: "agent",
      outcome: "Record red-first evidence against the approved exact plan.",
      approvalRequired: true,
      validationGateKeys: ["focused-approval-tests"],
    },
    {
      key: "implementation",
      title: "Repair approval presentation",
      owner: "agent",
      outcome: "Make the focused tests green without changing decision persistence.",
      approvalRequired: false,
      validationGateKeys: ["aggregate-validate"],
    },
    {
      key: "review",
      title: "Inspect operator experience",
      owner: "human",
      outcome: "Inspect realistic evidence and document remaining limitations.",
      approvalRequired: true,
      validationGateKeys: ["seeded-approval-browser"],
    },
  ],
  steps: [
    {
      title: "Protect the existing decision contract",
      outcome:
        "Write failing presentation and decision-context tests while retaining regressions for stale responses, operator attribution, duplicate submissions, and decisions that save before a refresh fails.",
      owner: "agent",
      requiresApproval: false,
    },
    {
      title: "Present a readable structured review",
      outcome:
        "Show repository and issue context, ordered work, planned validation, risks with mitigations, and evidence inside the active confirmation context. Keep complete raw content and exact identity available as secondary technical details.",
      owner: "agent",
      requiresApproval: false,
    },
    {
      title: "Inspect the composed experience",
      outcome:
        "Review the requested and completed gate at 390px and desktop widths in both themes, exercise keyboard controls, and retain screenshots together with deterministic test output before handing the repair back for review.",
      owner: "human",
      requiresApproval: true,
    },
  ],
  validationGates: [
    {
      key: "focused-approval-tests",
      name: "Approval presentation and persistence",
      command:
        "bun run test tests/unit/portal/approval-review.test.tsx tests/unit/portal/approval-review.integration.test.ts",
      phase: "before_implementation",
      required: true,
      evidence:
        "Failing assertions before implementation, then passing presentation and persistence regressions.",
    },
    {
      key: "aggregate-validate",
      name: "Repository validation",
      command: "bun run validate",
      phase: "before_review",
      required: true,
      evidence:
        "Ordered command output, including fixture browser checks and Storybook build; no claim that planned checks have already passed.",
    },
    {
      key: "seeded-approval-browser",
      name: "Seeded approval browser review",
      command: "bun run test:e2e:seeded",
      phase: "before_review",
      required: true,
      evidence:
        "Serial local Postgres browser results and inspected mobile/desktop screenshots in light and dark themes.",
    },
  ],
  approvalPoints: [
    {
      key: "plan-review",
      required: true,
      reviewer: "signed-in operator",
      evidence: [
        "exact planning artifact",
        "issue acceptance criteria",
        "proposed validation and risk mitigations",
      ],
      reason:
        "Approve this exact plan for the test-writing stage; later implementation, publication and external writes remain subject to their existing gates.",
    },
  ],
  risks: [
    {
      key: "lost-decision-context",
      severity: "high",
      description:
        "An operator could confirm a decision while the relevant plan and linked evidence are hidden behind a modal, making approval depend on memory rather than the exact work being authorized.",
      mitigation:
        "Keep the structured plan and evidence accessible within the active keyboard and screen-reader context, and retain them after the saved decision.",
    },
    {
      key: "misleading-verification",
      severity: "medium",
      description:
        "Metadata such as a scope or loop identifier could be mistaken for a completed validation result, especially when long technical identifiers dominate a narrow screen.",
      mitigation:
        "Label attached context as metadata, distinguish planned validation from actual results, and reserve verification language for identified supporting evidence.",
    },
  ],
  fixtureMode: {
    activationEnv: "LOOPWORKS_EVE_FIXTURE_MODE",
    label: "fixture",
    productionPolicy: "fail-closed",
  },
  evalCoverage: [
    {
      mechanism: "golden-fixture",
      command: "bun test tests/unit/agent/planning-agent.test.ts",
      covers: ["plan artifact schema", "acceptance criteria extraction", "tool contract summary"],
    },
    {
      mechanism: "eve-eval",
      command: "bunx eve eval planning --skip-report --timeout 180000",
      covers: ["runtime prompt changes", "model changes", "tool-call regressions"],
    },
  ],
  toolContractSummary: {
    allowedTools: [
      {
        name: "prepare_repository_context",
        capability: "Prepare a read-only isolated checkout pinned to an exact commit.",
        mutates: false,
        auditFields: ["agent", "repo", "issue", "run", "step", "traceId"],
      },
      {
        name: "list_repository_files",
        capability: "Discover bounded tracked repository paths by safe glob patterns.",
        mutates: false,
        auditFields: ["agent", "repo", "issue", "run", "step", "traceId"],
      },
      {
        name: "search_repository",
        capability: "Search bounded repository text with path and line provenance.",
        mutates: false,
        auditFields: ["agent", "repo", "issue", "run", "step", "traceId"],
      },
      {
        name: "read_repository_files",
        capability: "Read bounded file ranges from the pinned repository context.",
        mutates: false,
        auditFields: ["agent", "repo", "issue", "run", "step", "traceId"],
      },
      {
        name: "read_issue_context",
        capability: "Read supplied GitHub issue context and summarize acceptance criteria.",
        mutates: false,
        auditFields: ["agent", "repo", "issue", "run", "step", "traceId"],
      },
      {
        name: "summarize_validation_requirements",
        capability: "Map acceptance criteria to deterministic validation gates.",
        mutates: false,
        auditFields: ["agent", "repo", "issue", "run", "step", "traceId"],
      },
      {
        name: "list_github_backlog",
        capability: "List bounded issue summaries for the durable run's GitHub repository.",
        mutates: false,
        auditFields: ["agent", "repo", "run", "tool", "traceId"],
      },
      {
        name: "read_github_backlog_item",
        capability: "Read one bounded issue, its comments, and its relationships.",
        mutates: false,
        auditFields: ["agent", "repo", "issue", "run", "tool", "traceId"],
      },
      {
        name: "list_github_backlog_taxonomy",
        capability: "List bounded labels and milestones for the durable run's repository.",
        mutates: false,
        auditFields: ["agent", "repo", "run", "tool", "traceId"],
      },
      {
        name: "emit_plan_artifact",
        capability: "Emit the validated plan artifact only.",
        mutates: true,
        auditFields: ["agent", "repo", "issue", "run", "step", "traceId"],
      },
    ],
    blockedCapabilities: [
      "repository file writes",
      "branch mutation",
      "GitHub issue/PR mutation",
      "Azure resource mutation",
      "arbitrary provider routes or queries",
      "arbitrary web fetch/search",
      "copy-agent delegation",
    ],
    planArtifactOnlyWrite: true,
    planningOnly: true,
  },
} satisfies PlanningAgentOutput;
