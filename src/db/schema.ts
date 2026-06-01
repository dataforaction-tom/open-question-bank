import { sql } from 'drizzle-orm'
import {
  pgTable,
  pgEnum,
  serial,
  uuid,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  vector,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'

export const visibilityEnum = pgEnum('visibility', ['anonymous', 'public'])

// Full lifecycle from spec §5. Slice 1 only ever writes 'submitted' or 'merged_as_variant';
// the remaining states land in later slices but are declared now so the enum is stable.
export const questionStateEnum = pgEnum('question_state', [
  'submitted',
  'flagged',
  'rejected',
  'merged_as_variant',
  'clustered',
  'canonical',
  'under_comparison',
  'ranked',
  'synthesised',
  'archived',
])

export const moderationActionEnum = pgEnum('moderation_action', ['approve', 'reject'])

// One row per pinned-embedding configuration. Changing the embedding model mints a NEW row
// (and, later, a re-embed migration). Exactly one row is active at a time (enforced below).
export const datasetVersion = pgTable(
  'dataset_version',
  {
    id: serial('id').primaryKey(),
    embeddingModel: text('embedding_model').notNull(),
    embeddingModelDigest: text('embedding_model_digest').notNull(),
    embeddingDim: integer('embedding_dim').notNull(),
    dedupThreshold: doublePrecision('dedup_threshold').notNull().default(0.15),
    clusterThreshold: doublePrecision('cluster_threshold').notNull().default(0.2),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // At most one active version — protects the reproducibility commitment and closes the
    // read-then-insert race in ensureActiveDatasetVersion.
    uniqueIndex('one_active_dataset_version')
      .on(table.isActive)
      .where(sql`${table.isActive} = true`),
  ],
)

export const question = pgTable(
  'question',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rawText: text('raw_text').notNull(), // immutable: exactly as submitted
    canonicalText: text('canonical_text').notNull(), // current best form (= raw_text at submit)
    embedding: vector('embedding', { dimensions: 768 }),
    embeddingModelVersion: text('embedding_model_version').notNull(),
    datasetVersionId: integer('dataset_version_id')
      .notNull()
      .references(() => datasetVersion.id),
    submitterRef: text('submitter_ref'), // nullable: pseudonymous token or account ref
    visibility: visibilityEnum('visibility').notNull(),
    state: questionStateEnum('state').notNull().default('submitted'),
    tags: text('tags').array(),
    theme: text('theme'),
    clusterId: uuid('cluster_id').references((): AnyPgColumn => cluster.id),
    canonicalOf: uuid('canonical_of').references((): AnyPgColumn => question.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // HNSW index for fast cosine-distance nearest-neighbour (dedup + clustering).
    index('question_embedding_hnsw').using('hnsw', table.embedding.op('vector_cosine_ops')),
    index('question_dataset_version_idx').on(table.datasetVersionId),
  ],
)

export const cluster = pgTable(
  'cluster',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    datasetVersionId: integer('dataset_version_id')
      .notNull()
      .references(() => datasetVersion.id),
    representativeQuestionId: uuid('representative_question_id')
      .notNull()
      .references((): AnyPgColumn => question.id),
    thresholdUsed: doublePrecision('threshold_used').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('cluster_dataset_version_idx').on(table.datasetVersionId)],
)

export const moderationEvent = pgTable(
  'moderation_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => question.id),
    action: moderationActionEnum('action').notNull(),
    actorRef: text('actor_ref').notNull(),
    reason: text('reason'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('moderation_event_question_idx').on(table.questionId)],
)

export type Question = typeof question.$inferSelect
export type NewQuestion = typeof question.$inferInsert
export type DatasetVersion = typeof datasetVersion.$inferSelect
export type Cluster = typeof cluster.$inferSelect
export type ModerationEvent = typeof moderationEvent.$inferSelect
