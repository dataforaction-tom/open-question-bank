CREATE TYPE "public"."synthesis_proposed_by" AS ENUM('llm', 'human');--> statement-breakpoint
CREATE TYPE "public"."synthesis_status" AS ENUM('proposed', 'rejected', 'superseded');--> statement-breakpoint
CREATE TABLE "synthesis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"synthesised_text" text NOT NULL,
	"source_question_ids" uuid[] NOT NULL,
	"rationale" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"proposed_by" "synthesis_proposed_by" NOT NULL,
	"model" text,
	"model_version" text,
	"endorsed_by" text[] DEFAULT '{}' NOT NULL,
	"status" "synthesis_status" DEFAULT 'proposed' NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "synthesis" ADD CONSTRAINT "synthesis_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synthesis" ADD CONSTRAINT "synthesis_supersedes_id_synthesis_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."synthesis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "synthesis_campaign_idx" ON "synthesis" USING btree ("campaign_id");