CREATE TYPE "public"."question_state" AS ENUM('submitted', 'flagged', 'rejected', 'merged_as_variant', 'clustered', 'canonical', 'under_comparison', 'ranked', 'synthesised', 'archived');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('anonymous', 'public');--> statement-breakpoint
CREATE TABLE "dataset_version" (
	"id" serial PRIMARY KEY NOT NULL,
	"embedding_model" text NOT NULL,
	"embedding_model_digest" text NOT NULL,
	"embedding_dim" integer NOT NULL,
	"dedup_threshold" double precision DEFAULT 0.15 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raw_text" text NOT NULL,
	"canonical_text" text NOT NULL,
	"embedding" vector(768),
	"embedding_model_version" text NOT NULL,
	"dataset_version_id" integer NOT NULL,
	"submitter_ref" text,
	"visibility" "visibility" NOT NULL,
	"state" "question_state" DEFAULT 'submitted' NOT NULL,
	"tags" text[],
	"theme" text,
	"cluster_id" uuid,
	"canonical_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_dataset_version_id_dataset_version_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."dataset_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_canonical_of_question_id_fk" FOREIGN KEY ("canonical_of") REFERENCES "public"."question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_dataset_version" ON "dataset_version" USING btree ("is_active") WHERE "dataset_version"."is_active" = true;--> statement-breakpoint
CREATE INDEX "question_embedding_hnsw" ON "question" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "question_dataset_version_idx" ON "question" USING btree ("dataset_version_id");