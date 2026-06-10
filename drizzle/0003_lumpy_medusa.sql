CREATE TYPE "public"."definedness_criterion" AS ENUM('specific', 'answerable', 'scoped', 'non-leading', 'single-barrelled');--> statement-breakpoint
ALTER TYPE "public"."moderation_action" ADD VALUE 'promote';--> statement-breakpoint
CREATE TABLE "definedness_score" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"criterion" "definedness_criterion" NOT NULL,
	"score" integer NOT NULL,
	"rationale" text NOT NULL,
	"model" text NOT NULL,
	"model_version" text NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "definedness_score_range" CHECK ("definedness_score"."score" BETWEEN 1 AND 5)
);
--> statement-breakpoint
ALTER TABLE "definedness_score" ADD CONSTRAINT "definedness_score_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "definedness_score_question_idx" ON "definedness_score" USING btree ("question_id");