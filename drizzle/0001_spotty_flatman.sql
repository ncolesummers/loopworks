CREATE TYPE "public"."repo_health" AS ENUM('healthy', 'watch', 'blocked', 'disconnected');--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "health" "repo_health" DEFAULT 'healthy' NOT NULL;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "framework" text DEFAULT 'Unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "default_branch" text DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "ci_commands" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "docs_href" text;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "observability_href" text;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "design_system_href" text;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "enabled_loops" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "validation_gates" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "last_synced_at" timestamp with time zone;