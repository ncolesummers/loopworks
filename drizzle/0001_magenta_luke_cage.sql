CREATE TABLE "github_installation_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_digest" text NOT NULL,
	"actor_id" text NOT NULL,
	"phase" text NOT NULL,
	"installation_id" bigint,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_installation_flows_state_digest_unique" UNIQUE("state_digest")
);
--> statement-breakpoint
CREATE TABLE "github_installations" (
	"installation_id" bigint PRIMARY KEY NOT NULL,
	"app_id" bigint NOT NULL,
	"account_id" bigint NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"repository_selection" text NOT NULL,
	"installed_by" text NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "github_installation_flows_actor_phase_idx" ON "github_installation_flows" USING btree ("actor_id","phase");