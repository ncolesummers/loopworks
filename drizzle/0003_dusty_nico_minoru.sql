ALTER TYPE "public"."artifact_type" ADD VALUE 'test_plan' BEFORE 'patch';--> statement-breakpoint
ALTER TABLE "agent_plans" ALTER COLUMN "agent_name" SET DEFAULT 'planner';
