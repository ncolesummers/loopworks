import type { RepositorySelectionSnapshot } from "@/lib/github/repository-selection";
import {
  createDevelopmentLoopRunSkeleton,
  projectDevelopmentLoopArtifacts,
  projectDevelopmentLoopTimeline,
} from "@/lib/loops/development-run";
import type { LoopRegistrationSnapshot } from "@/lib/loops/loop-registration-flow";
import { buildRunFixtureRecords } from "@/lib/runs/fixtures";
import type {
  FixtureState,
  GitHubSettingRecord,
  LoopRegistryItem,
  RegisteredLoopItem,
} from "@/lib/types";

const developmentLoopFixture = createDevelopmentLoopRunSkeleton({
  mode: "simulated",
  now: new Date("2026-07-02T16:00:00.000Z"),
  trigger: {
    issueNumber: 11,
    issueUrl: "https://github.com/ncolesummers/loopworks/issues/11",
    labels: ["agent-ready", "area:loops", "area:agents", "loop:development", "priority:p0"],
    milestone: "M3 Durable Loop MVP",
    repositoryFullName: "ncolesummers/loopworks",
    title: "Agent-ready development loop skeleton",
  },
});

const developmentLoopTimeline = projectDevelopmentLoopTimeline(developmentLoopFixture);
const developmentLoopArtifacts = projectDevelopmentLoopArtifacts(developmentLoopFixture);

/**
 * Development-only snapshot for the repository selection surface. Fixture mode never reaches
 * GitHub, so this keeps the surface exercisable in Storybook, Playwright, and `dev:fixture`.
 */
export const repositorySelectionFixture: RepositorySelectionSnapshot = {
  installation: {
    accountLogin: "ncolesummers",
    accountType: "User",
    appId: 800_000,
    installationId: 800_000_001,
    repositorySelection: "selected",
  },
  repositories: [
    {
      accessible: true,
      archived: false,
      defaultBranch: "main",
      fullName: "ncolesummers/loopworks-web",
      githubRepoId: 900_000_001,
      name: "loopworks-web",
      owner: "ncolesummers",
      private: false,
      selected: true,
    },
    {
      accessible: true,
      archived: false,
      defaultBranch: "main",
      fullName: "ncolesummers/loopworks-agent",
      githubRepoId: 900_000_002,
      name: "loopworks-agent",
      owner: "ncolesummers",
      private: true,
      selected: false,
    },
    {
      accessible: true,
      archived: true,
      defaultBranch: "main",
      fullName: "ncolesummers/loopworks-legacy",
      githubRepoId: 900_000_003,
      name: "loopworks-legacy",
      owner: "ncolesummers",
      private: false,
      selected: false,
    },
  ],
  status: "ready",
};

/**
 * Development-only snapshot for the loop registration surface. Fixture repository ids are not
 * database rows, so the surface disables registering rather than attempting a write that would fail.
 */
export const loopRegistrationFixture: LoopRegistrationSnapshot = {
  repositories: [
    {
      defaultBranch: "main",
      fullName: "ncolesummers/loopworks-web",
      id: "00000000-0000-4000-8000-000000000001",
      name: "loopworks-web",
      owner: "ncolesummers",
    },
    {
      defaultBranch: "main",
      fullName: "ncolesummers/loopworks-agent",
      id: "00000000-0000-4000-8000-000000000002",
      name: "loopworks-agent",
      owner: "ncolesummers",
    },
  ],
  status: "ready",
};

export const portalFixture: FixtureState = {
  githubInstallations: [
    {
      installationId: 800_000_001,
      accountLogin: "ncolesummers",
      accountType: "User",
      repositorySelection: "selected",
    },
  ],
  repos: [
    {
      name: "loopworks-web",
      owner: "ncolesummers",
      description: "Operator portal for repo intake, approvals, and deploy visibility.",
      health: "healthy",
      githubHref: "https://github.com/ncolesummers/loopworks-web",
      framework: "Next.js",
      defaultBranch: "main",
      ciCommands: ["bun run validate", "bun run build"],
      docsHref: "https://github.com/ncolesummers/loopworks/tree/main/docs",
      observabilityHref:
        "https://github.com/ncolesummers/loopworks/blob/main/docs/observability.md",
      designSystemHref:
        "https://github.com/ncolesummers/loopworks/blob/main/docs/design-review-checklist.md",
      enabledLoops: ["Intake and triage", "Implementation routing"],
      validationGates: ["Typecheck", "Playwright", "Storybook"],
      vercelProjectId: "prj_loopworks",
      vercelProjectHref: "https://vercel.com/ncolesummers/loopworks",
      milestone: "M1",
      area: "design-system",
      priority: "p0",
      openIssues: 14,
      staleDays: 1,
      lastSynced: "2m ago",
    },
    {
      name: "factory-core",
      owner: "ncolesummers",
      description: "Loop engine, issue ingestion, and durable execution history.",
      health: "watch",
      githubHref: "https://github.com/ncolesummers/factory-core",
      framework: "Bun + Drizzle",
      defaultBranch: "main",
      ciCommands: ["bun run test", "bun run typecheck"],
      docsHref: "https://github.com/ncolesummers/loopworks/blob/main/docs/loop-manifest.md",
      observabilityHref:
        "https://github.com/ncolesummers/loopworks/blob/main/docs/observability.md",
      designSystemHref:
        "https://github.com/ncolesummers/loopworks/blob/main/docs/design-review-checklist.md",
      enabledLoops: ["Implementation routing"],
      validationGates: ["Unit tests", "Webhook idempotency", "Logger redaction"],
      vercelProjectId: "prj_factory_core",
      vercelProjectHref: "https://vercel.com/ncolesummers/factory-core",
      milestone: "M3",
      area: "loop-mvp",
      priority: "p0",
      openIssues: 27,
      staleDays: 4,
      lastSynced: "8m ago",
    },
    {
      name: "delivery-ops",
      owner: "ncolesummers",
      description: "Blocked deployment workflow catalog fixture for gate and loop visibility.",
      health: "blocked",
      githubHref: "https://github.com/ncolesummers/delivery-ops",
      framework: "Next.js",
      defaultBranch: "main",
      ciCommands: ["bun run validate", "bun run test:e2e"],
      docsHref: "https://github.com/ncolesummers/loopworks/blob/main/docs/prd.md",
      observabilityHref:
        "https://github.com/ncolesummers/loopworks/blob/main/docs/observability.md",
      designSystemHref:
        "https://github.com/ncolesummers/loopworks/blob/main/docs/design-review-checklist.md",
      enabledLoops: ["Review gate"],
      validationGates: ["Playwright", "Storybook"],
      vercelProjectId: "prj_delivery_ops",
      vercelProjectHref: "https://vercel.com/ncolesummers/delivery-ops",
      milestone: "M2",
      area: "catalog",
      priority: "p0",
      openIssues: 3,
      staleDays: 6,
      lastSynced: "14m ago",
    },
    {
      name: "integration-playground",
      owner: "ncolesummers",
      description: "Sandbox repo used to exercise GitHub and Vercel sync paths.",
      health: "disconnected",
      githubHref: "https://github.com/ncolesummers/integration-playground",
      framework: "Fixture",
      defaultBranch: "main",
      ciCommands: ["bun run test:e2e"],
      docsHref:
        "https://github.com/ncolesummers/loopworks/blob/main/docs/personas-and-test-scenarios.md",
      observabilityHref:
        "https://github.com/ncolesummers/loopworks/blob/main/docs/observability.md",
      designSystemHref:
        "https://github.com/ncolesummers/loopworks/blob/main/docs/design-review-checklist.md",
      enabledLoops: [],
      validationGates: ["Fixture fallback check"],
      milestone: "M2",
      area: "github",
      priority: "p1",
      openIssues: 6,
      staleDays: 9,
      lastSynced: "17m ago",
    },
  ],
  deployments: [
    {
      name: "preview/portal-shell",
      state: "ready",
      environment: "preview",
      branch: "codex/m1-shell",
      sha: "8f2c1c4",
      url: "https://loopworks-git-codex-m1-shell.vercel.app",
      age: "12m",
      checks: ["Preview ready", "Playwright passed", "A11y baseline"],
      inspectorUrl: "https://vercel.com/ncolesummers/loopworks/dpl_preview_shell",
    },
    {
      name: "production/main",
      state: "ready",
      environment: "production",
      branch: "main",
      sha: "7ad2f90",
      url: "https://loopworks.vercel.app",
      age: "1h",
      checks: ["Build ready", "Runtime logs clean"],
      inspectorUrl: "https://vercel.com/ncolesummers/loopworks/dpl_prod",
    },
    {
      name: "preview/building",
      state: "building",
      environment: "preview",
      branch: "codex/9-vercel-deploy",
      sha: "pending",
      age: "Queued",
      checks: ["Build started"],
    },
    {
      name: "preview/errored",
      state: "error",
      environment: "preview",
      branch: "codex/failed-preview",
      sha: "badc0de",
      url: "https://loopworks-git-failed.vercel.app",
      age: "3m",
      checks: ["Build failed"],
      inspectorUrl: "https://vercel.com/ncolesummers/loopworks/dpl_error",
    },
    {
      name: "preview/queued",
      state: "queued",
      environment: "preview",
      branch: "feature/github-sync",
      sha: "c1b9ae8",
      age: "4m",
      checks: ["Waiting for upload", "Awaiting preview URL"],
    },
  ],
  loops: [
    {
      name: "Intake and triage",
      state: "Triage",
      enabled: true,
      owner: "Avery",
      queueDepth: 4,
      risk: "low",
    },
    {
      name: "Implementation routing",
      state: "In Progress",
      enabled: true,
      owner: "Morgan",
      queueDepth: 7,
      risk: "medium",
    },
    {
      name: "Review gate",
      state: "Waiting on Review",
      enabled: false,
      owner: "Security",
      queueDepth: 2,
      risk: "high",
    },
    {
      name: "Research routing",
      state: "Planned",
      enabled: true,
      owner: "Loopworks",
      queueDepth: 1,
      risk: "low",
    },
  ] satisfies LoopRegistryItem[],
  registeredLoops: [
    {
      approvalRequirements: ["external_write", "pr_creation", "manifest_rollout"],
      enabled: true,
      key: "development-loop",
      name: "Agent-ready development loop",
      repositoryFullName: "ncolesummers/loopworks",
      triggerLabels: ["agent-ready"],
      validationGates: [
        { key: "focused-tests", name: "Focused manifest tests", required: true },
        { key: "aggregate-validation", name: "Aggregate validation", required: true },
      ],
    },
    {
      approvalRequirements: ["manifest_rollout"],
      enabled: false,
      key: "research-loop",
      name: "Research loop",
      repositoryFullName: "ncolesummers/loopworks-agent",
      triggerLabels: ["agent-ready", "spike"],
      validationGates: [{ key: "research-review", name: "Research review", required: false }],
    },
  ] satisfies RegisteredLoopItem[],
  timeline: developmentLoopTimeline,
  artifacts: [
    ...developmentLoopArtifacts,
    {
      label: "Preview URL",
      href: "https://loopworks-git-codex-m1-shell.vercel.app",
      detail: "Vercel preview for the latest dashboard shell fixture.",
      state: "available",
      kind: "preview",
    },
    {
      label: "CI validation artifact",
      href: "https://github.com/ncolesummers/loopworks/actions",
      detail: "Deterministic checks captured before reviewer signoff.",
      state: "available",
      kind: "validation",
    },
    {
      label: "Security review notes",
      href: "https://github.com/ncolesummers/loopworks/issues/23",
      detail: "Pending approval notes for the high-risk write-path review.",
      state: "pending",
      kind: "review",
    },
  ],
  validationResults: [
    {
      name: "Typecheck",
      command: "bun run typecheck",
      status: "passed",
      duration: "18s",
      detail: "Strict TypeScript completed without emitting.",
      artifactHref: "https://github.com/ncolesummers/loopworks/actions",
    },
    {
      name: "Playwright",
      command: "bun run test:e2e",
      status: "passed",
      duration: "1m 12s",
      detail: "Portal smoke and axe checks passed in light and dark.",
      artifactHref: "https://github.com/ncolesummers/loopworks/actions",
    },
    {
      name: "Storybook a11y",
      command: "bun run storybook:build",
      status: "warning",
      duration: "42s",
      detail: "Component review is ready for manual screenshot baseline approval.",
    },
  ],
  approval: {
    state: "needs-review",
    owner: "Priya",
    due: "Today, 4:00 PM",
    risk: "Token scopes cover GitHub read access and Vercel preview metadata only.",
    checklist: [
      { label: "Session handling is documented", done: true },
      { label: "Repo access is scoped per installation", done: true },
      { label: "Secrets are redacted from summaries", done: true },
      { label: "Write paths require explicit approval", done: false },
    ],
  },
  runs: buildRunFixtureRecords(),
  githubSettings: [
    {
      key: "sso",
      title: "GitHub SSO",
      detail: "Authenticated with org-managed sign-in and local fixture bypass for development.",
      enabled: true,
    },
    {
      key: "webhooks",
      title: "Webhooks",
      detail: "Issue and PR webhooks hydrate the loop registry and deployment snapshots.",
      enabled: true,
    },
    {
      key: "issue-sync",
      title: "Issue sync",
      detail: "Milestones, labels, and comments are mirrored into the operator catalog.",
      enabled: true,
    },
    {
      key: "pr-sync",
      title: "PR sync",
      detail: "Pull request checks and review status are visible before merge gating.",
      enabled: true,
    },
    {
      key: "label-mapping",
      title: "Label mapping",
      detail: "Milestone, priority, and area labels map to loop states and ownership.",
      enabled: true,
    },
    {
      key: "secret-redaction",
      title: "Secret redaction",
      detail: "Tokens and webhook payload fragments stay out of logs and UI summaries.",
      enabled: true,
    },
  ] satisfies GitHubSettingRecord[],
};
