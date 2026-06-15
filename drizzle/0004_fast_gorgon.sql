CREATE TYPE "public"."campaign_scope" AS ENUM('sealed', 'global');--> statement-breakpoint
CREATE TYPE "public"."campaign_state" AS ENUM('draft', 'open', 'comparing', 'synthesising', 'closed');--> statement-breakpoint
CREATE TABLE "campaign" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt" text NOT NULL,
	"comparison_axis" text NOT NULL,
	"scope" "campaign_scope" DEFAULT 'sealed' NOT NULL,
	"state" "campaign_state" DEFAULT 'draft' NOT NULL,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_question" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comparison" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"question_a_id" uuid NOT NULL,
	"question_b_id" uuid NOT NULL,
	"winner_question_id" uuid,
	"judge_ref" text NOT NULL,
	"served_reason" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comparison_distinct" CHECK ("comparison"."question_a_id" <> "comparison"."question_b_id"),
	CONSTRAINT "comparison_winner_valid" CHECK ("comparison"."winner_question_id" IS NULL OR "comparison"."winner_question_id" = "comparison"."question_a_id" OR "comparison"."winner_question_id" = "comparison"."question_b_id")
);
--> statement-breakpoint
CREATE TABLE "score" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"mu" double precision NOT NULL,
	"sigma" double precision NOT NULL,
	"n_comparisons" integer DEFAULT 0 NOT NULL,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_question" ADD CONSTRAINT "campaign_question_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_question" ADD CONSTRAINT "campaign_question_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison" ADD CONSTRAINT "comparison_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison" ADD CONSTRAINT "comparison_question_a_id_question_id_fk" FOREIGN KEY ("question_a_id") REFERENCES "public"."question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison" ADD CONSTRAINT "comparison_question_b_id_question_id_fk" FOREIGN KEY ("question_b_id") REFERENCES "public"."question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison" ADD CONSTRAINT "comparison_winner_question_id_question_id_fk" FOREIGN KEY ("winner_question_id") REFERENCES "public"."question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score" ADD CONSTRAINT "score_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score" ADD CONSTRAINT "score_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_question_unique" ON "campaign_question" USING btree ("campaign_id","question_id");--> statement-breakpoint
CREATE INDEX "campaign_question_campaign_idx" ON "campaign_question" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "comparison_campaign_idx" ON "comparison" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "score_campaign_question_unique" ON "score" USING btree ("campaign_id","question_id");--> statement-breakpoint
CREATE INDEX "score_campaign_idx" ON "score" USING btree ("campaign_id");