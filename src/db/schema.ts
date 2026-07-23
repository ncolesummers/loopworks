import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { approvalStatusValues } from "@/lib/approvals";

import { loopStateValues } from "../../schemas/loop-manifest";

export const loopStateEnum = pgEnum("loop_state", loopStateValues);
export const approvalStatusEnum = pgEnum("approval_status", approvalStatusValues);
export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", [
  "received",
  "processed",
  "ignored",
  "failed",
]);
export const deploymentStatusEnum = pgEnum("deployment_status", [
  "queued",
  "building",
  "ready",
  "error",
  "canceled",
]);
export const repoHealthEnum = pgEnum("repo_health", [
  "healthy",
  "watch",
  "blocked",
  "disconnected",
]);
export const runStatusEnum = pgEnum("run_status", [
  "queued",
  "running",
  "waiting_for_approval",
  "blocked",
  "failed",
  "succeeded",
  "canceled",
]);
export const runTerminalReasonEnum = pgEnum("run_terminal_reason", [
  "succeeded",
  "failed",
  "timed_out",
  "stalled",
  "canceled_by_reconciliation",
]);
export const runStepStatusEnum = pgEnum("run_step_status", [
  "queued",
  "running",
  "skipped",
  "failed",
  "succeeded",
]);
export const artifactTypeEnum = pgEnum("artifact_type", [
  "plan",
  "validation_report",
  "test_plan",
  "patch",
  "pr_intent",
  "deployment_summary",
  "log_summary",
  "trace",
  "screenshot",
  "other",
]);
export const idempotencyLockStatusEnum = pgEnum("idempotency_lock_status", [
  "acquired",
  "released",
  "expired",
]);
export const observabilitySeverityEnum = pgEnum("observability_severity", [
  "debug",
  "info",
  "warn",
  "error",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  githubLogin: text("github_login").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => ({
    compoundKey: primaryKey({
      columns: [table.provider, table.providerAccountId],
    }),
  }),
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (table) => ({
    compoundKey: primaryKey({
      columns: [table.identifier, table.token],
    }),
  }),
);

export const repositories = pgTable(
  "repositories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    githubRepoId: bigint("github_repo_id", { mode: "number" }).notNull().unique(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name").notNull().unique(),
    installationId: bigint("installation_id", { mode: "number" }),
    isActive: boolean("is_active").default(true).notNull(),
    health: repoHealthEnum("health").default("healthy").notNull(),
    framework: text("framework").default("Unknown").notNull(),
    defaultBranch: text("default_branch").default("main").notNull(),
    ciCommands: text("ci_commands").array().default([]).notNull(),
    docsHref: text("docs_href"),
    observabilityHref: text("observability_href"),
    designSystemHref: text("design_system_href"),
    enabledLoops: text("enabled_loops").array().default([]).notNull(),
    validationGates: text("validation_gates").array().default([]).notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  () => ({}),
);

export const vercelProjects = pgTable(
  "vercel_projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().unique(),
    projectName: text("project_name").notNull(),
    teamId: text("team_id"),
    teamSlug: text("team_slug"),
    productionUrl: text("production_url"),
    dashboardUrl: text("dashboard_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    repositoryIdIndex: index("vercel_projects_repository_id_idx").on(table.repositoryId),
  }),
);

export const loops = pgTable(
  "loops",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    githubIssueNumber: integer("github_issue_number").notNull(),
    title: text("title").notNull(),
    state: loopStateEnum("state").default("intake").notNull(),
    milestone: text("milestone"),
    areaLabel: text("area_label"),
    priorityLabel: text("priority_label"),
    ownerGithubLogin: text("owner_github_login"),
    sourceUrl: text("source_url"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    repositoryIssueNumberIndex: uniqueIndex("loops_repository_issue_number_idx").on(
      table.repositoryId,
      table.githubIssueNumber,
    ),
  }),
);

export const loopRuns = pgTable(
  "loop_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    loopKey: text("loop_key").notNull(),
    githubIssueNumber: integer("github_issue_number"),
    githubIssueUrl: text("github_issue_url"),
    status: runStatusEnum("status").default("queued").notNull(),
    terminalReason: runTerminalReasonEnum("terminal_reason"),
    currentStage: text("current_stage").default("planning").notNull(),
    traceId: text("trace_id"),
    costCents: integer("cost_cents").default(0).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    queuedAt: timestamp("queued_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
  },
  (table) => ({
    repositoryStatusIndex: index("loop_runs_repository_status_idx").on(
      table.repositoryId,
      table.status,
    ),
    issueIndex: index("loop_runs_repository_issue_idx").on(
      table.repositoryId,
      table.githubIssueNumber,
    ),
  }),
);

export const runSteps = pgTable(
  "run_steps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => loopRuns.id, { onDelete: "cascade" }),
    stage: text("stage").notNull(),
    status: runStepStatusEnum("status").default("queued").notNull(),
    attempt: integer("attempt").default(1).notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    summary: text("summary"),
    validationCommand: text("validation_command"),
    validationStatus: text("validation_status"),
    traceId: text("trace_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    queuedAt: timestamp("queued_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    runStageIndex: index("run_steps_run_stage_idx").on(table.runId, table.stage),
    runStatusIndex: index("run_steps_run_status_idx").on(table.runId, table.status),
  }),
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => loopRuns.id, { onDelete: "cascade" }),
    stepId: uuid("step_id").references(() => runSteps.id, { onDelete: "set null" }),
    type: artifactTypeEnum("type").default("other").notNull(),
    title: text("title").notNull(),
    uri: text("uri").notNull(),
    sha256: text("sha256"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    runTypeIndex: index("artifacts_run_type_idx").on(table.runId, table.type),
    stepIndex: index("artifacts_step_id_idx").on(table.stepId),
  }),
);

export const loopEvents = pgTable(
  "loop_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    loopId: uuid("loop_id")
      .notNull()
      .references(() => loops.id, { onDelete: "cascade" }),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    eventType: text("event_type").notNull(),
    fromState: loopStateEnum("from_state"),
    toState: loopStateEnum("to_state"),
    reason: text("reason"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    loopCreatedAtIndex: index("loop_events_loop_id_created_at_idx").on(
      table.loopId,
      table.createdAt,
    ),
  }),
);

export const idempotencyLocks = pgTable(
  "idempotency_locks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    key: text("key").notNull().unique(),
    scope: text("scope").notNull(),
    owner: text("owner").notNull(),
    status: idempotencyLockStatusEnum("status").default("acquired").notNull(),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (table) => ({
    scopeStatusIndex: index("idempotency_locks_scope_status_idx").on(table.scope, table.status),
    expiresAtIndex: index("idempotency_locks_expires_at_idx").on(table.expiresAt),
  }),
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: text("source").default("github").notNull(),
    deliveryId: text("delivery_id").notNull().unique(),
    event: text("event").notNull(),
    action: text("action"),
    repositoryFullName: text("repository_full_name"),
    status: webhookDeliveryStatusEnum("status").default("received").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  () => ({}),
);

export const observabilityEvents = pgTable(
  "observability_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repositoryId: uuid("repository_id").references(() => repositories.id, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => loopRuns.id, { onDelete: "set null" }),
    stepId: uuid("step_id").references(() => runSteps.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    severity: observabilitySeverityEnum("severity").default("info").notNull(),
    correlationId: text("correlation_id"),
    traceId: text("trace_id"),
    metricName: text("metric_name"),
    metricValue: integer("metric_value"),
    message: text("message"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    eventTypeCreatedAtIndex: index("observability_events_type_created_at_idx").on(
      table.eventType,
      table.createdAt,
    ),
    runCreatedAtIndex: index("observability_events_run_created_at_idx").on(
      table.runId,
      table.createdAt,
    ),
    traceIdIndex: index("observability_events_trace_id_idx").on(table.traceId),
  }),
);

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    loopId: uuid("loop_id").references(() => loops.id, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => loopRuns.id, { onDelete: "set null" }),
    scope: text("scope").notNull(),
    status: approvalStatusEnum("status").default("requested").notNull(),
    requestedBy: text("requested_by").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    note: text("note"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (table) => ({
    loopStatusIndex: index("approvals_loop_id_status_idx").on(table.loopId, table.status),
    runStatusIndex: index("approvals_run_id_status_idx").on(table.runId, table.status),
  }),
);

export const approvalTransitionEvents = pgTable(
  "approval_transition_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    approvalId: uuid("approval_id")
      .notNull()
      .references(() => approvals.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => loopRuns.id, { onDelete: "set null" }),
    fromStatus: approvalStatusEnum("from_status").notNull(),
    toStatus: approvalStatusEnum("to_status").notNull(),
    action: text("action").notNull(),
    actorId: text("actor_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    note: text("note"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (table) => ({
    approvalCreatedAtIndex: index("approval_transition_events_approval_created_at_idx").on(
      table.approvalId,
      table.occurredAt,
    ),
    runCreatedAtIndex: index("approval_transition_events_run_created_at_idx").on(
      table.runId,
      table.occurredAt,
    ),
  }),
);

export const deployments = pgTable(
  "deployments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repositoryId: uuid("repository_id").references(() => repositories.id, { onDelete: "set null" }),
    loopId: uuid("loop_id").references(() => loops.id, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => loopRuns.id, { onDelete: "set null" }),
    provider: text("provider").default("vercel").notNull(),
    externalId: text("external_id").notNull().unique(),
    projectId: text("project_id"),
    projectName: text("project_name").notNull(),
    status: deploymentStatusEnum("status").notNull(),
    environment: text("environment").notNull(),
    branch: text("branch"),
    commitSha: text("commit_sha"),
    url: text("url").notNull(),
    inspectorUrl: text("inspector_url"),
    aliasUrls: text("alias_urls").array().default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (table) => ({
    projectCreatedAtIndex: index("deployments_project_id_created_at_idx").on(
      table.projectId,
      table.createdAt,
    ),
    runCreatedAtIndex: index("deployments_run_id_created_at_idx").on(table.runId, table.createdAt),
  }),
);

export const agentPlans = pgTable(
  "agent_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    loopId: uuid("loop_id").references(() => loops.id, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => loopRuns.id, { onDelete: "set null" }),
    issueNumber: integer("issue_number"),
    agentName: text("agent_name").default("planner").notNull(),
    status: text("status").default("pending").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    plan: jsonb("plan").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    loopCreatedAtIndex: index("agent_plans_loop_id_created_at_idx").on(
      table.loopId,
      table.createdAt,
    ),
    runCreatedAtIndex: index("agent_plans_run_id_created_at_idx").on(table.runId, table.createdAt),
  }),
);
