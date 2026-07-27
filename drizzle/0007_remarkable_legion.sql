ALTER TABLE "idempotency_locks" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "idempotency_locks" ADD COLUMN "trace_id" text;--> statement-breakpoint
ALTER TABLE "idempotency_locks" ADD CONSTRAINT "idempotency_locks_run_id_loop_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."loop_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idempotency_locks_run_status_idx" ON "idempotency_locks" USING btree ("run_id","status");--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "loop_runs"
    WHERE "github_issue_number" IS NOT NULL
      AND (
        "status" IN ('queued', 'running', 'waiting_for_approval', 'blocked')
        OR ("status" = 'failed' AND "completed_at" IS NULL)
      )
    GROUP BY "repository_id", "github_issue_number"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce active issue uniqueness: duplicate nonterminal loop runs exist';
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "loop_runs_active_repository_issue_idx" ON "loop_runs" USING btree ("repository_id","github_issue_number") WHERE "loop_runs"."github_issue_number" IS NOT NULL AND ("loop_runs"."status" IN ('queued', 'running', 'waiting_for_approval', 'blocked') OR ("loop_runs"."status" = 'failed' AND "loop_runs"."completed_at" IS NULL));
