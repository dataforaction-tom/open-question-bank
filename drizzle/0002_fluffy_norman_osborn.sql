CREATE TYPE "public"."refinement_action" AS ENUM('accept', 'reject', 'edit');--> statement-breakpoint
CREATE TYPE "public"."refinement_suggested_by" AS ENUM('llm', 'human');--> statement-breakpoint
CREATE TABLE "refinement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"before" text NOT NULL,
	"llm_suggested_text" text,
	"after" text,
	"criteria_applied" text[],
	"critique" jsonb,
	"suggested_by" "refinement_suggested_by" NOT NULL,
	"model" text,
	"model_version" text,
	"action" "refinement_action" NOT NULL,
	"actor_ref" text NOT NULL,
	"rationale" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refinement" ADD CONSTRAINT "refinement_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refinement_question_idx" ON "refinement" USING btree ("question_id");