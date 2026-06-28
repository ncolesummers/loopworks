CREATE TYPE "public"."approval_status" AS ENUM('requested', 'approved', 'rejected', 'cancelled', 'expired', 'applied');--> statement-breakpoint
CREATE TYPE "public"."artifact_type" AS ENUM('plan', 'validation_report', 'patch', 'pr_intent', 'deployment_summary', 'log_summary', 'trace', 'other');--> statement-breakpoint
CREATE TYPE "public"."deployment_status" AS ENUM('queued', 'building', 'ready', 'error', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."idempotency_lock_status" AS ENUM('acquired', 'released', 'expired');--> statement-breakpoint
CREATE TYPE "public"."loop_state" AS ENUM('intake', 'triage', 'planned', 'in_progress', 'waiting_on_review', 'validating', 'blocked', 'done');--> statement-breakpoint
CREATE TYPE "public"."observability_severity" AS ENUM('debug', 'info', 'warn', 'error');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'waiting_for_approval', 'blocked', 'failed', 'succeeded', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."run_step_status" AS ENUM('queued', 'running', 'skipped', 'failed', 'succeeded');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('received', 'processed', 'ignored', 'failed');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "agent_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loop_id" uuid,
	"run_id" uuid,
	"issue_number" integer,
	"agent_name" text DEFAULT 'eve-planning-agent' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"input" jsonb NOT NULL,
	"plan" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loop_id" uuid,
	"run_id" uuid,
	"scope" text NOT NULL,
	"status" "approval_status" DEFAULT 'requested' NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"note" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step_id" uuid,
	"type" "artifact_type" DEFAULT 'other' NOT NULL,
	"title" text NOT NULL,
	"uri" text NOT NULL,
	"sha256" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid,
	"loop_id" uuid,
	"run_id" uuid,
	"provider" text DEFAULT 'vercel' NOT NULL,
	"external_id" text NOT NULL,
	"project_id" text,
	"project_name" text NOT NULL,
	"status" "deployment_status" NOT NULL,
	"environment" text NOT NULL,
	"branch" text,
	"commit_sha" text,
	"url" text NOT NULL,
	"inspector_url" text,
	"alias_urls" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"ready_at" timestamp with time zone,
	"metadata" jsonb,
	CONSTRAINT "deployments_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "idempotency_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"scope" text NOT NULL,
	"owner" text NOT NULL,
	"status" "idempotency_lock_status" DEFAULT 'acquired' NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"metadata" jsonb,
	CONSTRAINT "idempotency_locks_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "loop_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loop_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"event_type" text NOT NULL,
	"from_state" "loop_state",
	"to_state" "loop_state",
	"reason" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loop_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"loop_key" text NOT NULL,
	"github_issue_number" integer,
	"github_issue_url" text,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"current_stage" text DEFAULT 'planning' NOT NULL,
	"trace_id" text,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"canceled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "loops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"github_issue_number" integer NOT NULL,
	"title" text NOT NULL,
	"state" "loop_state" DEFAULT 'intake' NOT NULL,
	"milestone" text,
	"area_label" text,
	"priority_label" text,
	"owner_github_login" text,
	"source_url" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observability_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid,
	"run_id" uuid,
	"step_id" uuid,
	"event_type" text NOT NULL,
	"severity" "observability_severity" DEFAULT 'info' NOT NULL,
	"correlation_id" text,
	"trace_id" text,
	"metric_name" text,
	"metric_value" integer,
	"message" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_repo_id" bigint NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"installation_id" bigint,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repositories_github_repo_id_unique" UNIQUE("github_repo_id"),
	CONSTRAINT "repositories_full_name_unique" UNIQUE("full_name")
);
--> statement-breakpoint
CREATE TABLE "run_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"status" "run_step_status" DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"summary" text,
	"validation_command" text,
	"validation_status" text,
	"trace_id" text,
	"metadata" jsonb,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"email" text,
	"email_verified" timestamp with time zone,
	"image" text,
	"github_login" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_github_login_unique" UNIQUE("github_login")
);
--> statement-breakpoint
CREATE TABLE "vercel_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"project_id" text NOT NULL,
	"project_name" text NOT NULL,
	"team_id" text,
	"team_slug" text,
	"production_url" text,
	"dashboard_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vercel_projects_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text DEFAULT 'github' NOT NULL,
	"delivery_id" text NOT NULL,
	"event" text NOT NULL,
	"action" text,
	"repository_full_name" text,
	"status" "webhook_delivery_status" DEFAULT 'received' NOT NULL,
	"payload" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "webhook_deliveries_delivery_id_unique" UNIQUE("delivery_id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_plans" ADD CONSTRAINT "agent_plans_loop_id_loops_id_fk" FOREIGN KEY ("loop_id") REFERENCES "public"."loops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_plans" ADD CONSTRAINT "agent_plans_run_id_loop_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."loop_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_loop_id_loops_id_fk" FOREIGN KEY ("loop_id") REFERENCES "public"."loops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_run_id_loop_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."loop_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_run_id_loop_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."loop_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_step_id_run_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."run_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_loop_id_loops_id_fk" FOREIGN KEY ("loop_id") REFERENCES "public"."loops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_run_id_loop_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."loop_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loop_events" ADD CONSTRAINT "loop_events_loop_id_loops_id_fk" FOREIGN KEY ("loop_id") REFERENCES "public"."loops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loop_runs" ADD CONSTRAINT "loop_runs_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loops" ADD CONSTRAINT "loops_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observability_events" ADD CONSTRAINT "observability_events_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observability_events" ADD CONSTRAINT "observability_events_run_id_loop_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."loop_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observability_events" ADD CONSTRAINT "observability_events_step_id_run_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."run_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_loop_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."loop_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vercel_projects" ADD CONSTRAINT "vercel_projects_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_plans_loop_id_created_at_idx" ON "agent_plans" USING btree ("loop_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_plans_run_id_created_at_idx" ON "agent_plans" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "approvals_loop_id_status_idx" ON "approvals" USING btree ("loop_id","status");--> statement-breakpoint
CREATE INDEX "approvals_run_id_status_idx" ON "approvals" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "artifacts_run_type_idx" ON "artifacts" USING btree ("run_id","type");--> statement-breakpoint
CREATE INDEX "artifacts_step_id_idx" ON "artifacts" USING btree ("step_id");--> statement-breakpoint
CREATE INDEX "deployments_project_id_created_at_idx" ON "deployments" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "deployments_run_id_created_at_idx" ON "deployments" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "idempotency_locks_scope_status_idx" ON "idempotency_locks" USING btree ("scope","status");--> statement-breakpoint
CREATE INDEX "idempotency_locks_expires_at_idx" ON "idempotency_locks" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "loop_events_loop_id_created_at_idx" ON "loop_events" USING btree ("loop_id","created_at");--> statement-breakpoint
CREATE INDEX "loop_runs_repository_status_idx" ON "loop_runs" USING btree ("repository_id","status");--> statement-breakpoint
CREATE INDEX "loop_runs_repository_issue_idx" ON "loop_runs" USING btree ("repository_id","github_issue_number");--> statement-breakpoint
CREATE UNIQUE INDEX "loops_repository_issue_number_idx" ON "loops" USING btree ("repository_id","github_issue_number");--> statement-breakpoint
CREATE INDEX "observability_events_type_created_at_idx" ON "observability_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "observability_events_run_created_at_idx" ON "observability_events" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "observability_events_trace_id_idx" ON "observability_events" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "run_steps_run_stage_idx" ON "run_steps" USING btree ("run_id","stage");--> statement-breakpoint
CREATE INDEX "run_steps_run_status_idx" ON "run_steps" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "vercel_projects_repository_id_idx" ON "vercel_projects" USING btree ("repository_id");