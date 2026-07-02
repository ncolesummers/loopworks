import { inArray } from "drizzle-orm";

import type { db } from "@/db/client";
import {
  approvalTransitionEvents,
  approvals,
  artifacts,
  deployments,
  loopRuns,
  loops,
  repositories,
  runSteps,
  vercelProjects,
} from "@/db/schema";

export type SeedDatabase = Pick<typeof db, "transaction">;

export type SeedCounts = {
  repositories: number;
  vercelProjects: number;
  loops: number;
  loopRuns: number;
  runSteps: number;
  artifacts: number;
  approvals: number;
  approvalTransitionEvents: number;
  deployments: number;
};

const seedNamespaces = {
  repositories: 1,
  vercelProjects: 2,
  loops: 3,
  loopRuns: 4,
  runSteps: 5,
  artifacts: 6,
  approvals: 7,
  deployments: 8,
  approvalTransitionEvents: 9,
} as const;

function seedId(table: keyof typeof seedNamespaces, index: number): string {
  const namespaceHex = seedNamespaces[table].toString(16).padStart(2, "0");
  const indexHex = (index + 1).toString(16).padStart(12, "0");
  return `${namespaceHex}000000-0000-4000-8000-${indexHex}`;
}

export const demoSeedIds = {
  repositories: {
    loopworksWeb: seedId("repositories", 0),
    factoryCore: seedId("repositories", 1),
    deliveryOps: seedId("repositories", 2),
    integrationPlayground: seedId("repositories", 3),
  },
  vercelProjects: {
    loopworksWeb: seedId("vercelProjects", 0),
    factoryCore: seedId("vercelProjects", 1),
  },
  loops: {
    intake: seedId("loops", 0),
    triage: seedId("loops", 1),
    planned: seedId("loops", 2),
    inProgress: seedId("loops", 3),
    waitingOnReview: seedId("loops", 4),
    validating: seedId("loops", 5),
    blocked: seedId("loops", 6),
    done: seedId("loops", 7),
  },
  loopRuns: {
    queued: seedId("loopRuns", 0),
    running: seedId("loopRuns", 1),
    waitingForApproval: seedId("loopRuns", 2),
    blocked: seedId("loopRuns", 3),
    failed: seedId("loopRuns", 4),
    succeeded: seedId("loopRuns", 5),
    canceled: seedId("loopRuns", 6),
  },
  runSteps: {
    queued: seedId("runSteps", 0),
    running: seedId("runSteps", 1),
    succeeded: seedId("runSteps", 2),
    failed: seedId("runSteps", 3),
    skipped: seedId("runSteps", 4),
  },
  artifacts: {
    plan: seedId("artifacts", 0),
    validationReport: seedId("artifacts", 1),
    patch: seedId("artifacts", 2),
    prIntent: seedId("artifacts", 3),
    deploymentSummary: seedId("artifacts", 4),
    logSummary: seedId("artifacts", 5),
    trace: seedId("artifacts", 6),
    other: seedId("artifacts", 7),
  },
  approvals: {
    requested: seedId("approvals", 0),
    approved: seedId("approvals", 1),
    rejected: seedId("approvals", 2),
    cancelled: seedId("approvals", 3),
    expired: seedId("approvals", 4),
    applied: seedId("approvals", 5),
    bypassed: seedId("approvals", 6),
  },
  approvalTransitionEvents: {
    approved: seedId("approvalTransitionEvents", 0),
    rejected: seedId("approvalTransitionEvents", 1),
    bypassed: seedId("approvalTransitionEvents", 2),
    applied: seedId("approvalTransitionEvents", 3),
    cancelled: seedId("approvalTransitionEvents", 4),
    expired: seedId("approvalTransitionEvents", 5),
  },
  deployments: {
    productionReady: seedId("deployments", 0),
    previewBuilding: seedId("deployments", 1),
    previewError: seedId("deployments", 2),
    previewQueued: seedId("deployments", 3),
    previewCanceled: seedId("deployments", 4),
  },
} as const;

export type DemoSeedData = {
  repositories: (typeof repositories.$inferInsert)[];
  vercelProjects: (typeof vercelProjects.$inferInsert)[];
  loops: (typeof loops.$inferInsert)[];
  loopRuns: (typeof loopRuns.$inferInsert)[];
  runSteps: (typeof runSteps.$inferInsert)[];
  artifacts: (typeof artifacts.$inferInsert)[];
  approvals: (typeof approvals.$inferInsert)[];
  approvalTransitionEvents: (typeof approvalTransitionEvents.$inferInsert)[];
  deployments: (typeof deployments.$inferInsert)[];
};

/**
 * Builds the Loopworks demo seed dataset: synthetic rows (no real tokens,
 * secrets, or customer data, per ADR 0007) that exercise every status enum
 * value across the control-plane schema, so local development and demos stay
 * inspectable without masking what production integrations still owe.
 */
export function buildDemoSeedData(): DemoSeedData {
  const ids = demoSeedIds;

  const repositoriesData: DemoSeedData["repositories"] = [
    {
      id: ids.repositories.loopworksWeb,
      githubRepoId: 900_000_001,
      owner: "ncolesummers",
      name: "loopworks-web",
      fullName: "ncolesummers/loopworks-web",
      installationId: 800_000_001,
      health: "healthy",
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
      lastSyncedAt: new Date("2026-06-30T09:00:00.000Z"),
    },
    {
      id: ids.repositories.factoryCore,
      githubRepoId: 900_000_002,
      owner: "ncolesummers",
      name: "factory-core",
      fullName: "ncolesummers/factory-core",
      installationId: 800_000_001,
      health: "watch",
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
      lastSyncedAt: new Date("2026-06-30T08:52:00.000Z"),
    },
    {
      id: ids.repositories.deliveryOps,
      githubRepoId: 900_000_003,
      owner: "ncolesummers",
      name: "delivery-ops",
      fullName: "ncolesummers/delivery-ops",
      installationId: 800_000_001,
      health: "blocked",
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
      lastSyncedAt: new Date("2026-06-30T08:46:00.000Z"),
    },
    {
      id: ids.repositories.integrationPlayground,
      githubRepoId: 900_000_004,
      owner: "ncolesummers",
      name: "integration-playground",
      fullName: "ncolesummers/integration-playground",
      installationId: null,
      isActive: false,
      health: "disconnected",
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
      lastSyncedAt: null,
    },
  ];

  const vercelProjectsData: DemoSeedData["vercelProjects"] = [
    {
      id: ids.vercelProjects.loopworksWeb,
      repositoryId: ids.repositories.loopworksWeb,
      projectId: "prj_demo_loopworks_web",
      projectName: "loopworks-web",
      teamId: "team_demo_loopworks",
      teamSlug: "loopworks-team",
      productionUrl: "https://loopworks.vercel.app",
      dashboardUrl: "https://vercel.com/ncolesummers/loopworks",
    },
    {
      id: ids.vercelProjects.factoryCore,
      repositoryId: ids.repositories.factoryCore,
      projectId: "prj_demo_factory_core",
      projectName: "factory-core",
      teamId: "team_demo_loopworks",
      teamSlug: "loopworks-team",
      productionUrl: "https://factory-core.vercel.app",
      dashboardUrl: "https://vercel.com/ncolesummers/factory-core",
    },
  ];

  const loopsData: DemoSeedData["loops"] = [
    {
      id: ids.loops.intake,
      repositoryId: ids.repositories.loopworksWeb,
      githubIssueNumber: 101,
      title: "Intake new repo requests",
      state: "intake",
      milestone: "M1",
      areaLabel: "area:control-plane",
      priorityLabel: "priority:p1",
      ownerGithubLogin: "avery-dev",
      sourceUrl: "https://github.com/ncolesummers/loopworks-web/issues/101",
      lastSyncedAt: new Date("2026-06-30T09:01:00.000Z"),
    },
    {
      id: ids.loops.triage,
      repositoryId: ids.repositories.loopworksWeb,
      githubIssueNumber: 102,
      title: "Triage flaky Playwright run",
      state: "triage",
      milestone: "M1",
      areaLabel: "area:validation",
      priorityLabel: "priority:p2",
      ownerGithubLogin: "avery-dev",
      sourceUrl: "https://github.com/ncolesummers/loopworks-web/issues/102",
      lastSyncedAt: new Date("2026-06-30T09:02:00.000Z"),
    },
    {
      id: ids.loops.planned,
      repositoryId: ids.repositories.factoryCore,
      githubIssueNumber: 201,
      title: "Plan webhook retry policy",
      state: "planned",
      milestone: "M2",
      areaLabel: "area:github",
      priorityLabel: "priority:p1",
      ownerGithubLogin: "morgan-dev",
      sourceUrl: "https://github.com/ncolesummers/factory-core/issues/201",
      lastSyncedAt: new Date("2026-06-30T08:53:00.000Z"),
    },
    {
      id: ids.loops.inProgress,
      repositoryId: ids.repositories.factoryCore,
      githubIssueNumber: 202,
      title: "Implement idempotency lock sweep",
      state: "in_progress",
      milestone: "M2",
      areaLabel: "area:infra",
      priorityLabel: "priority:p0",
      ownerGithubLogin: "morgan-dev",
      sourceUrl: "https://github.com/ncolesummers/factory-core/issues/202",
      lastSyncedAt: new Date("2026-06-30T08:54:00.000Z"),
    },
    {
      id: ids.loops.waitingOnReview,
      repositoryId: ids.repositories.deliveryOps,
      githubIssueNumber: 301,
      title: "Review deploy-gate write scope",
      state: "waiting_on_review",
      milestone: "M2",
      areaLabel: "area:security",
      priorityLabel: "priority:p0",
      ownerGithubLogin: "priya-sec",
      sourceUrl: "https://github.com/ncolesummers/delivery-ops/issues/301",
      lastSyncedAt: new Date("2026-06-30T08:47:00.000Z"),
    },
    {
      id: ids.loops.validating,
      repositoryId: ids.repositories.deliveryOps,
      githubIssueNumber: 302,
      title: "Validate rollback runbook",
      state: "validating",
      milestone: "M2",
      areaLabel: "area:validation",
      priorityLabel: "priority:p1",
      ownerGithubLogin: "priya-sec",
      sourceUrl: "https://github.com/ncolesummers/delivery-ops/issues/302",
      lastSyncedAt: new Date("2026-06-30T08:48:00.000Z"),
    },
    {
      id: ids.loops.blocked,
      repositoryId: ids.repositories.deliveryOps,
      githubIssueNumber: 303,
      title: "Blocked on missing Vercel scope grant",
      state: "blocked",
      milestone: "M2",
      areaLabel: "area:infra",
      priorityLabel: "priority:p0",
      ownerGithubLogin: "priya-sec",
      sourceUrl: "https://github.com/ncolesummers/delivery-ops/issues/303",
      lastSyncedAt: new Date("2026-06-30T08:49:00.000Z"),
    },
    {
      id: ids.loops.done,
      repositoryId: ids.repositories.loopworksWeb,
      githubIssueNumber: 103,
      title: "Ship deployment visibility panel",
      state: "done",
      milestone: "M2",
      areaLabel: "area:ui",
      priorityLabel: "priority:p1",
      ownerGithubLogin: "avery-dev",
      sourceUrl: "https://github.com/ncolesummers/loopworks-web/issues/103",
      lastSyncedAt: new Date("2026-06-30T09:03:00.000Z"),
    },
  ];

  const loopRunsData: DemoSeedData["loopRuns"] = [
    {
      id: ids.loopRuns.queued,
      repositoryId: ids.repositories.loopworksWeb,
      loopKey: "intake-triage",
      githubIssueNumber: 101,
      githubIssueUrl: "https://github.com/ncolesummers/loopworks-web/issues/101",
      status: "queued",
      currentStage: "planning",
      queuedAt: new Date("2026-06-30T09:05:00.000Z"),
    },
    {
      id: ids.loopRuns.running,
      repositoryId: ids.repositories.loopworksWeb,
      loopKey: "intake-triage",
      githubIssueNumber: 102,
      githubIssueUrl: "https://github.com/ncolesummers/loopworks-web/issues/102",
      status: "running",
      currentStage: "test-writing",
      queuedAt: new Date("2026-06-30T09:06:00.000Z"),
      startedAt: new Date("2026-06-30T09:07:00.000Z"),
    },
    {
      id: ids.loopRuns.waitingForApproval,
      repositoryId: ids.repositories.factoryCore,
      loopKey: "implementation-routing",
      githubIssueNumber: 201,
      githubIssueUrl: "https://github.com/ncolesummers/factory-core/issues/201",
      status: "waiting_for_approval",
      currentStage: "review",
      queuedAt: new Date("2026-06-30T08:55:00.000Z"),
      startedAt: new Date("2026-06-30T08:56:00.000Z"),
    },
    {
      id: ids.loopRuns.blocked,
      repositoryId: ids.repositories.deliveryOps,
      loopKey: "review-gate",
      githubIssueNumber: 303,
      githubIssueUrl: "https://github.com/ncolesummers/delivery-ops/issues/303",
      status: "blocked",
      currentStage: "validation",
      metadata: {
        blockedReason: "Blocked on missing Vercel scope grant.",
      },
      queuedAt: new Date("2026-06-30T08:50:00.000Z"),
      startedAt: new Date("2026-06-30T08:51:00.000Z"),
    },
    {
      id: ids.loopRuns.failed,
      repositoryId: ids.repositories.deliveryOps,
      loopKey: "review-gate",
      githubIssueNumber: 301,
      githubIssueUrl: "https://github.com/ncolesummers/delivery-ops/issues/301",
      status: "failed",
      currentStage: "validation",
      queuedAt: new Date("2026-06-30T08:44:00.000Z"),
      startedAt: new Date("2026-06-30T08:45:00.000Z"),
      completedAt: new Date("2026-06-30T08:46:30.000Z"),
    },
    {
      id: ids.loopRuns.succeeded,
      repositoryId: ids.repositories.loopworksWeb,
      loopKey: "implementation-routing",
      githubIssueNumber: 103,
      githubIssueUrl: "https://github.com/ncolesummers/loopworks-web/issues/103",
      status: "succeeded",
      currentStage: "done",
      queuedAt: new Date("2026-06-30T08:40:00.000Z"),
      startedAt: new Date("2026-06-30T08:41:00.000Z"),
      completedAt: new Date("2026-06-30T08:59:00.000Z"),
    },
    {
      id: ids.loopRuns.canceled,
      repositoryId: ids.repositories.factoryCore,
      loopKey: "implementation-routing",
      githubIssueNumber: 202,
      githubIssueUrl: "https://github.com/ncolesummers/factory-core/issues/202",
      status: "canceled",
      currentStage: "planning",
      queuedAt: new Date("2026-06-30T08:30:00.000Z"),
      canceledAt: new Date("2026-06-30T08:32:00.000Z"),
    },
  ];

  const runStepsData: DemoSeedData["runSteps"] = [
    {
      id: ids.runSteps.queued,
      runId: ids.loopRuns.running,
      stage: "planning",
      status: "queued",
      actorType: "agent",
      actorId: "eve-planning-agent",
      summary: "Waiting to start the planning stage.",
      queuedAt: new Date("2026-06-30T09:06:30.000Z"),
    },
    {
      id: ids.runSteps.running,
      runId: ids.loopRuns.running,
      stage: "test-writing",
      status: "running",
      actorType: "agent",
      actorId: "eve-builder-agent",
      summary: "Writing failing tests before the production change.",
      queuedAt: new Date("2026-06-30T09:07:00.000Z"),
      startedAt: new Date("2026-06-30T09:07:05.000Z"),
    },
    {
      id: ids.runSteps.succeeded,
      runId: ids.loopRuns.succeeded,
      stage: "development",
      status: "succeeded",
      actorType: "agent",
      actorId: "eve-builder-agent",
      summary: "Implemented the smallest green change.",
      validationCommand: "bun run validate",
      validationStatus: "passed",
      queuedAt: new Date("2026-06-30T08:42:00.000Z"),
      startedAt: new Date("2026-06-30T08:42:30.000Z"),
      completedAt: new Date("2026-06-30T08:55:00.000Z"),
    },
    {
      id: ids.runSteps.failed,
      runId: ids.loopRuns.failed,
      stage: "validation",
      status: "failed",
      actorType: "agent",
      actorId: "eve-builder-agent",
      summary: "Deterministic validation failed before review.",
      validationCommand: "bun run validate",
      validationStatus: "failed",
      queuedAt: new Date("2026-06-30T08:45:30.000Z"),
      startedAt: new Date("2026-06-30T08:45:45.000Z"),
      completedAt: new Date("2026-06-30T08:46:20.000Z"),
    },
    {
      id: ids.runSteps.skipped,
      runId: ids.loopRuns.canceled,
      stage: "code-review",
      status: "skipped",
      actorType: "human",
      actorId: "morgan-dev",
      summary: "Run was canceled before code review started.",
      queuedAt: new Date("2026-06-30T08:31:00.000Z"),
    },
  ];

  const artifactsData: DemoSeedData["artifacts"] = [
    {
      id: ids.artifacts.plan,
      runId: ids.loopRuns.running,
      stepId: ids.runSteps.queued,
      type: "plan",
      title: "Planning artifact",
      uri: "https://github.com/ncolesummers/loopworks-web/issues/102#plan",
    },
    {
      id: ids.artifacts.validationReport,
      runId: ids.loopRuns.failed,
      stepId: ids.runSteps.failed,
      type: "validation_report",
      title: "Validation report",
      uri: "https://github.com/ncolesummers/delivery-ops/actions/runs/demo-validation-report",
    },
    {
      id: ids.artifacts.patch,
      runId: ids.loopRuns.succeeded,
      stepId: ids.runSteps.succeeded,
      type: "patch",
      title: "Applied patch",
      uri: "https://github.com/ncolesummers/loopworks-web/commit/demo-patch-sha",
    },
    {
      id: ids.artifacts.prIntent,
      runId: ids.loopRuns.succeeded,
      type: "pr_intent",
      title: "PR intent",
      uri: "https://github.com/ncolesummers/loopworks-web/pull/demo-pr-intent",
    },
    {
      id: ids.artifacts.deploymentSummary,
      runId: ids.loopRuns.succeeded,
      type: "deployment_summary",
      title: "Deployment summary",
      uri: "https://vercel.com/ncolesummers/loopworks/dpl_demo_summary",
    },
    {
      id: ids.artifacts.logSummary,
      runId: ids.loopRuns.failed,
      type: "log_summary",
      title: "Log summary",
      uri: "https://github.com/ncolesummers/delivery-ops/actions/runs/demo-log-summary",
    },
    {
      id: ids.artifacts.trace,
      runId: ids.loopRuns.running,
      type: "trace",
      title: "Run trace",
      uri: "https://github.com/ncolesummers/loopworks-web/actions/runs/demo-trace",
    },
    {
      id: ids.artifacts.other,
      runId: ids.loopRuns.canceled,
      type: "other",
      title: "Cancellation note",
      uri: "https://github.com/ncolesummers/factory-core/issues/202#cancellation-note",
    },
  ];

  const approvalsData: DemoSeedData["approvals"] = [
    {
      id: ids.approvals.requested,
      loopId: ids.loops.waitingOnReview,
      runId: ids.loopRuns.waitingForApproval,
      scope: "deploy-preview",
      status: "requested",
      requestedBy: "morgan-dev",
      requestedAt: new Date("2026-06-30T08:56:30.000Z"),
      note: "Requesting review before the preview promotes.",
    },
    {
      id: ids.approvals.approved,
      loopId: ids.loops.done,
      runId: ids.loopRuns.succeeded,
      scope: "pr-write",
      status: "approved",
      requestedBy: "avery-dev",
      requestedAt: new Date("2026-06-30T08:50:00.000Z"),
      resolvedBy: "priya-sec",
      resolvedAt: new Date("2026-06-30T08:58:00.000Z"),
      note: "Token scopes reviewed and approved.",
    },
    {
      id: ids.approvals.rejected,
      loopId: ids.loops.blocked,
      runId: ids.loopRuns.failed,
      scope: "deploy-production",
      status: "rejected",
      requestedBy: "priya-sec",
      requestedAt: new Date("2026-06-30T08:44:30.000Z"),
      resolvedBy: "priya-sec",
      resolvedAt: new Date("2026-06-30T08:46:40.000Z"),
      note: "Missing Vercel production scope grant.",
    },
    {
      id: ids.approvals.cancelled,
      runId: ids.loopRuns.canceled,
      scope: "pr-write",
      status: "cancelled",
      requestedBy: "morgan-dev",
      requestedAt: new Date("2026-06-30T08:31:30.000Z"),
      resolvedBy: "morgan-dev",
      resolvedAt: new Date("2026-06-30T08:32:00.000Z"),
      note: "Run canceled before approval was needed.",
    },
    {
      id: ids.approvals.expired,
      loopId: ids.loops.validating,
      scope: "deploy-preview",
      status: "expired",
      requestedBy: "priya-sec",
      requestedAt: new Date("2026-06-29T08:00:00.000Z"),
      resolvedBy: "loopworks-system",
      resolvedAt: new Date("2026-06-30T08:00:00.000Z"),
      note: "Approval window expired before resolution.",
    },
    {
      id: ids.approvals.applied,
      loopId: ids.loops.done,
      runId: ids.loopRuns.succeeded,
      scope: "pr-write",
      status: "applied",
      requestedBy: "avery-dev",
      requestedAt: new Date("2026-06-30T08:58:30.000Z"),
      resolvedBy: "avery-dev",
      resolvedAt: new Date("2026-06-30T08:59:30.000Z"),
      note: "Approved write path applied and merged.",
    },
    {
      id: ids.approvals.bypassed,
      loopId: ids.loops.inProgress,
      runId: ids.loopRuns.blocked,
      scope: "emergency-bypass",
      status: "bypassed",
      requestedBy: "morgan-dev",
      requestedAt: new Date("2026-06-30T08:51:30.000Z"),
      resolvedBy: "priya-sec",
      resolvedAt: new Date("2026-06-30T08:52:30.000Z"),
      note: "Emergency bypass recorded for blocked-run triage visibility.",
    },
  ];

  const approvalTransitionEventsData: DemoSeedData["approvalTransitionEvents"] = [
    {
      id: ids.approvalTransitionEvents.approved,
      approvalId: ids.approvals.approved,
      runId: ids.loopRuns.succeeded,
      fromStatus: "requested",
      toStatus: "approved",
      action: "approve",
      actorId: "priya-sec",
      occurredAt: new Date("2026-06-30T08:58:00.000Z"),
      note: "Token scopes reviewed and approved.",
    },
    {
      id: ids.approvalTransitionEvents.rejected,
      approvalId: ids.approvals.rejected,
      runId: ids.loopRuns.failed,
      fromStatus: "requested",
      toStatus: "rejected",
      action: "reject",
      actorId: "priya-sec",
      occurredAt: new Date("2026-06-30T08:46:40.000Z"),
      note: "Missing Vercel production scope grant.",
    },
    {
      id: ids.approvalTransitionEvents.bypassed,
      approvalId: ids.approvals.bypassed,
      runId: ids.loopRuns.blocked,
      fromStatus: "requested",
      toStatus: "bypassed",
      action: "bypass",
      actorId: "priya-sec",
      occurredAt: new Date("2026-06-30T08:52:30.000Z"),
      note: "Emergency bypass recorded for blocked-run triage visibility.",
    },
    {
      id: ids.approvalTransitionEvents.applied,
      approvalId: ids.approvals.applied,
      runId: ids.loopRuns.succeeded,
      fromStatus: "approved",
      toStatus: "applied",
      action: "apply",
      actorId: "avery-dev",
      occurredAt: new Date("2026-06-30T08:59:30.000Z"),
      note: "Approved write path applied and merged.",
    },
    {
      id: ids.approvalTransitionEvents.cancelled,
      approvalId: ids.approvals.cancelled,
      runId: ids.loopRuns.canceled,
      fromStatus: "requested",
      toStatus: "cancelled",
      action: "cancel",
      actorId: "morgan-dev",
      occurredAt: new Date("2026-06-30T08:32:00.000Z"),
      note: "Run canceled before approval was needed.",
    },
    {
      id: ids.approvalTransitionEvents.expired,
      approvalId: ids.approvals.expired,
      runId: null,
      fromStatus: "requested",
      toStatus: "expired",
      action: "expire",
      actorId: "loopworks-system",
      occurredAt: new Date("2026-06-30T08:00:00.000Z"),
      note: "Approval window expired before resolution.",
    },
  ];

  const deploymentsData: DemoSeedData["deployments"] = [
    {
      id: ids.deployments.productionReady,
      repositoryId: ids.repositories.loopworksWeb,
      runId: ids.loopRuns.succeeded,
      externalId: "dpl_demo_production_ready",
      projectId: "prj_demo_loopworks_web",
      projectName: "loopworks-web",
      status: "ready",
      environment: "production",
      branch: "main",
      commitSha: "demoprodsha01",
      url: "https://loopworks.vercel.app",
      inspectorUrl: "https://vercel.com/ncolesummers/loopworks/dpl_demo_production_ready",
      createdAt: new Date("2026-06-30T08:58:00.000Z"),
      readyAt: new Date("2026-06-30T08:59:40.000Z"),
    },
    {
      id: ids.deployments.previewBuilding,
      repositoryId: ids.repositories.loopworksWeb,
      runId: ids.loopRuns.running,
      externalId: "dpl_demo_preview_building",
      projectId: "prj_demo_loopworks_web",
      projectName: "loopworks-web",
      status: "building",
      environment: "preview",
      branch: "codex/20-seed-data",
      commitSha: "pending",
      url: "https://loopworks-git-codex-20-seed-data.vercel.app",
      inspectorUrl: "https://vercel.com/ncolesummers/loopworks/dpl_demo_preview_building",
      createdAt: new Date("2026-06-30T09:07:10.000Z"),
    },
    {
      id: ids.deployments.previewError,
      repositoryId: ids.repositories.factoryCore,
      runId: ids.loopRuns.canceled,
      externalId: "dpl_demo_preview_error",
      projectId: "prj_demo_factory_core",
      projectName: "factory-core",
      status: "error",
      environment: "preview",
      branch: "codex/202-idempotency-sweep",
      commitSha: "demofailsha02",
      url: "https://factory-core-git-failed.vercel.app",
      inspectorUrl: "https://vercel.com/ncolesummers/factory-core/dpl_demo_preview_error",
      createdAt: new Date("2026-06-30T08:33:00.000Z"),
    },
    {
      id: ids.deployments.previewQueued,
      repositoryId: ids.repositories.factoryCore,
      runId: ids.loopRuns.waitingForApproval,
      externalId: "dpl_demo_preview_queued",
      projectId: "prj_demo_factory_core",
      projectName: "factory-core",
      status: "queued",
      environment: "preview",
      branch: "codex/201-webhook-retry",
      commitSha: "pending",
      url: "https://factory-core-git-webhook-retry.vercel.app",
      createdAt: new Date("2026-06-30T08:57:00.000Z"),
    },
    {
      id: ids.deployments.previewCanceled,
      repositoryId: ids.repositories.deliveryOps,
      runId: ids.loopRuns.blocked,
      externalId: "dpl_demo_preview_canceled",
      projectId: null,
      projectName: "delivery-ops",
      status: "canceled",
      environment: "preview",
      branch: "codex/303-deploy-gate-scope",
      commitSha: "democancelsha03",
      url: "https://delivery-ops-git-deploy-gate.vercel.app",
      createdAt: new Date("2026-06-30T08:52:00.000Z"),
    },
  ];

  return {
    repositories: repositoriesData,
    vercelProjects: vercelProjectsData,
    loops: loopsData,
    loopRuns: loopRunsData,
    runSteps: runStepsData,
    artifacts: artifactsData,
    approvals: approvalsData,
    approvalTransitionEvents: approvalTransitionEventsData,
    deployments: deploymentsData,
  };
}

/**
 * Seeds (or resets and reseeds) the demo dataset. Every row is upserted by
 * fixed id, so re-running without `reset` is idempotent. `reset` deletes only
 * the exact fixed-id rows this module owns (by id, via `demoSeedIds`), in
 * FK-safe child-to-parent order, before reinserting - it never truncates a
 * whole table, so any non-demo rows that happen to share these tables are
 * left untouched.
 */
export async function seedDemoData(
  database: SeedDatabase,
  options: { reset?: boolean } = {},
): Promise<SeedCounts> {
  const data = buildDemoSeedData();
  const ids = demoSeedIds;

  return database.transaction(async (tx) => {
    if (options.reset) {
      await tx
        .delete(approvalTransitionEvents)
        .where(inArray(approvalTransitionEvents.id, Object.values(ids.approvalTransitionEvents)));
      await tx.delete(artifacts).where(inArray(artifacts.id, Object.values(ids.artifacts)));
      await tx.delete(runSteps).where(inArray(runSteps.id, Object.values(ids.runSteps)));
      await tx.delete(approvals).where(inArray(approvals.id, Object.values(ids.approvals)));
      await tx.delete(deployments).where(inArray(deployments.id, Object.values(ids.deployments)));
      await tx.delete(loopRuns).where(inArray(loopRuns.id, Object.values(ids.loopRuns)));
      await tx.delete(loops).where(inArray(loops.id, Object.values(ids.loops)));
      await tx
        .delete(vercelProjects)
        .where(inArray(vercelProjects.id, Object.values(ids.vercelProjects)));
      await tx
        .delete(repositories)
        .where(inArray(repositories.id, Object.values(ids.repositories)));
    }

    for (const row of data.repositories) {
      await tx.insert(repositories).values(row).onConflictDoUpdate({
        target: repositories.id,
        set: row,
      });
    }
    for (const row of data.vercelProjects) {
      await tx.insert(vercelProjects).values(row).onConflictDoUpdate({
        target: vercelProjects.id,
        set: row,
      });
    }
    for (const row of data.loops) {
      await tx.insert(loops).values(row).onConflictDoUpdate({
        target: loops.id,
        set: row,
      });
    }
    for (const row of data.loopRuns) {
      await tx.insert(loopRuns).values(row).onConflictDoUpdate({
        target: loopRuns.id,
        set: row,
      });
    }
    for (const row of data.runSteps) {
      await tx.insert(runSteps).values(row).onConflictDoUpdate({
        target: runSteps.id,
        set: row,
      });
    }
    for (const row of data.artifacts) {
      await tx.insert(artifacts).values(row).onConflictDoUpdate({
        target: artifacts.id,
        set: row,
      });
    }
    for (const row of data.approvals) {
      await tx.insert(approvals).values(row).onConflictDoUpdate({
        target: approvals.id,
        set: row,
      });
    }
    for (const row of data.approvalTransitionEvents) {
      await tx.insert(approvalTransitionEvents).values(row).onConflictDoUpdate({
        target: approvalTransitionEvents.id,
        set: row,
      });
    }
    for (const row of data.deployments) {
      await tx.insert(deployments).values(row).onConflictDoUpdate({
        target: deployments.id,
        set: row,
      });
    }

    return {
      repositories: data.repositories.length,
      vercelProjects: data.vercelProjects.length,
      loops: data.loops.length,
      loopRuns: data.loopRuns.length,
      runSteps: data.runSteps.length,
      artifacts: data.artifacts.length,
      approvals: data.approvals.length,
      approvalTransitionEvents: data.approvalTransitionEvents.length,
      deployments: data.deployments.length,
    };
  });
}
