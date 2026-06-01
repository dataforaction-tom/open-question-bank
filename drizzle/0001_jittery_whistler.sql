CREATE TYPE "public"."moderation_action" AS ENUM('approve', 'reject');--> statement-breakpoint
CREATE TABLE "cluster" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_version_id" integer NOT NULL,
	"representative_question_id" uuid NOT NULL,
	"threshold_used" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"action" "moderation_action" NOT NULL,
	"actor_ref" text NOT NULL,
	"reason" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dataset_version" ADD COLUMN "cluster_threshold" double precision DEFAULT 0.2 NOT NULL;--> statement-breakpoint
ALTER TABLE "cluster" ADD CONSTRAINT "cluster_dataset_version_id_dataset_version_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."dataset_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster" ADD CONSTRAINT "cluster_representative_question_id_question_id_fk" FOREIGN KEY ("representative_question_id") REFERENCES "public"."question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_event" ADD CONSTRAINT "moderation_event_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cluster_dataset_version_idx" ON "cluster" USING btree ("dataset_version_id");--> statement-breakpoint
CREATE INDEX "moderation_event_question_idx" ON "moderation_event" USING btree ("question_id");--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_cluster_id_cluster_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."cluster"("id") ON DELETE no action ON UPDATE no action;