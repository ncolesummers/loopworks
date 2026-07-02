ALTER TYPE "public"."approval_status" ADD VALUE 'bypassed';--> statement-breakpoint
CREATE TABLE "approval_transition_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"approval_id" uuid NOT NULL,
	"run_id" uuid,
	"from_status" "approval_status" NOT NULL,
	"to_status" "approval_status" NOT NULL,
	"action" text NOT NULL,
	"actor_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "approval_transition_events" ADD CONSTRAINT "approval_transition_events_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_transition_events" ADD CONSTRAINT "approval_transition_events_run_id_loop_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."loop_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_transition_events_approval_created_at_idx" ON "approval_transition_events" USING btree ("approval_id","occurred_at");--> statement-breakpoint
CREATE INDEX "approval_transition_events_run_created_at_idx" ON "approval_transition_events" USING btree ("run_id","occurred_at");