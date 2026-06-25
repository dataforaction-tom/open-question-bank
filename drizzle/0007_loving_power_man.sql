CREATE TABLE "workspace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Seed the single default workspace BEFORE the columns below backfill to its id and the FK
-- constraints validate. Idempotent so a re-run (or a DB already carrying the row) is safe.
INSERT INTO "workspace" ("id", "slug", "name")
VALUES ('00000000-0000-0000-0000-000000000001', 'default', 'Default workspace')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
DROP INDEX "one_active_dataset_version";--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "workspace_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "dataset_version" ADD COLUMN "workspace_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN "workspace_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_slug_unique" ON "workspace" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_version" ADD CONSTRAINT "dataset_version_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_workspace_idx" ON "campaign" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_dataset_version_per_workspace" ON "dataset_version" USING btree ("workspace_id") WHERE "dataset_version"."is_active" = true;--> statement-breakpoint
CREATE INDEX "dataset_version_workspace_idx" ON "dataset_version" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "question_workspace_idx" ON "question" USING btree ("workspace_id");