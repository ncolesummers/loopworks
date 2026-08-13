CREATE TABLE "store_identity" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"store_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"provisioned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_identity_single_row" CHECK ("store_identity"."id" = 1)
);
--> statement-breakpoint
-- Provisions the identity of this store (#158). Hand-added to the generated
-- migration: drizzle-kit emits schema, not data, and a store with no identity row
-- fails closed in production by design. Migrating an existing database therefore
-- issues it an id, which the operator must read and set as
-- LOOPWORKS_EXPECTED_STORE_ID before the next production read.
INSERT INTO "store_identity" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
