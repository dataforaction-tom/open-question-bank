import { sql } from 'drizzle-orm'
import {
  pgTable,
  pgEnum,
  serial,
  uuid,
  text,
  integer,
  jsonb,
  doublePrecision,
  boolean,
  timestamp,
  vector,
  index,
  uniqueIndex,
  check,
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

export const moderationActionEnum = pgEnum('moderation_action', ['approve', 'reject', 'promote'])

export const refinementSuggestedByEnum = pgEnum('refinement_suggested_by', ['llm', 'human'])
export const refinementActionEnum = pgEnum('refinement_action', ['accept', 'reject', 'edit'])

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

// Append-only training set: every LLM-assisted improvement to a question (spec §4).
// Rows are never mutated — corrections are new rows. canonical_text on `question` is the
// only thing an accepted/edited refinement updates. Embeddings are NOT touched (spec §8).
export const refinement = pgTable(
  'refinement',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => question.id),
    before: text('before').notNull(), // canonical_text at suggestion time
    llmSuggestedText: text('llm_suggested_text'), // the model's proposal (null for pure-human)
    after: text('after'), // text actually applied; null on reject
    criteriaApplied: text('criteria_applied').array(),
    critique:
      jsonb('critique').$type<{ criterion: string; verdict: 'pass' | 'fail'; note: string }[]>(),
    suggestedBy: refinementSuggestedByEnum('suggested_by').notNull(),
    model: text('model'),
    modelVersion: text('model_version'),
    action: refinementActionEnum('action').notNull(),
    actorRef: text('actor_ref').notNull(),
    rationale: text('rationale'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('refinement_question_idx').on(table.questionId)],
)

// The five definedness criteria (mirrors definedness-rubric.md and CRITERIA in src/lib/llm.ts).
export const definednessCriterionEnum = pgEnum('definedness_criterion', [
  'specific',
  'answerable',
  'scoped',
  'non-leading',
  'single-barrelled',
])

// Append-only model assessment at curation time (spec §4). One scoring run inserts five rows
// (one per criterion) in a single statement, so they share an identical now() timestamp —
// that shared timestamp is how runs are grouped. Rows are never mutated; re-scoring appends.
// model/model_version are NOT NULL: scores are always model-produced (no human path).
export const definednessScore = pgTable(
  'definedness_score',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => question.id),
    criterion: definednessCriterionEnum('criterion').notNull(),
    score: integer('score').notNull(),
    rationale: text('rationale').notNull(),
    model: text('model').notNull(),
    modelVersion: text('model_version').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('definedness_score_question_idx').on(table.questionId),
    // Belt-and-braces under the zod boundary validation (design §3).
    check('definedness_score_range', sql`${table.score} BETWEEN 1 AND 5`),
  ],
)

// ---- Slice 5a: campaigns + pairwise ranking (spec §4, §6) ----

// Only `sealed` is used in 5a; `global` is declared now so the enum is stable.
export const campaignScopeEnum = pgEnum('campaign_scope', ['sealed', 'global'])
// 5a uses draft → comparing → closed; the others land in later slices.
export const campaignStateEnum = pgEnum('campaign_state', [
  'draft',
  'open',
  'comparing',
  'synthesising',
  'closed',
])

export const campaign = pgTable('campaign', {
  id: uuid('id').primaryKey().defaultRandom(),
  prompt: text('prompt').notNull(),
  comparisonAxis: text('comparison_axis').notNull(), // free-text, e.g. "importance"
  scope: campaignScopeEnum('scope').notNull().default('sealed'),
  state: campaignStateEnum('state').notNull().default('draft'),
  opensAt: timestamp('opens_at', { withTimezone: true }),
  closesAt: timestamp('closes_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Sealed membership: the explicit set of canonical questions a campaign ranks.
export const campaignQuestion = pgTable(
  'campaign_question',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaign.id),
    questionId: uuid('question_id')
      .notNull()
      .references(() => question.id),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('campaign_question_unique').on(table.campaignId, table.questionId),
    index('campaign_question_campaign_idx').on(table.campaignId),
  ],
)

// Append-only judgement log — the source of truth. `winner_question_id` null = draw.
export const comparison = pgTable(
  'comparison',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaign.id),
    questionAId: uuid('question_a_id')
      .notNull()
      .references(() => question.id),
    questionBId: uuid('question_b_id')
      .notNull()
      .references(() => question.id),
    winnerQuestionId: uuid('winner_question_id').references(() => question.id),
    judgeRef: text('judge_ref').notNull(),
    servedReason: text('served_reason'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('comparison_campaign_idx').on(table.campaignId),
    index('comparison_campaign_judge_idx').on(table.campaignId, table.judgeRef),
    check('comparison_distinct', sql`${table.questionAId} <> ${table.questionBId}`),
    check(
      'comparison_winner_valid',
      sql`${table.winnerQuestionId} IS NULL OR ${table.winnerQuestionId} = ${table.questionAId} OR ${table.winnerQuestionId} = ${table.questionBId}`,
    ),
  ],
)

// Mutable projection of the comparison log: one row per (campaign, question).
export const score = pgTable(
  'score',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaign.id),
    questionId: uuid('question_id')
      .notNull()
      .references(() => question.id),
    mu: doublePrecision('mu').notNull(),
    sigma: doublePrecision('sigma').notNull(),
    nComparisons: integer('n_comparisons').notNull().default(0),
    lastUpdated: timestamp('last_updated', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('score_campaign_question_unique').on(table.campaignId, table.questionId),
    index('score_campaign_idx').on(table.campaignId),
  ],
)

export type Question = typeof question.$inferSelect
export type NewQuestion = typeof question.$inferInsert
export type DatasetVersion = typeof datasetVersion.$inferSelect
export type Cluster = typeof cluster.$inferSelect
export type ModerationEvent = typeof moderationEvent.$inferSelect
export type Refinement = typeof refinement.$inferSelect
export type NewRefinement = typeof refinement.$inferInsert
export type DefinednessScore = typeof definednessScore.$inferSelect
export type Campaign = typeof campaign.$inferSelect
export type CampaignQuestion = typeof campaignQuestion.$inferSelect
export type Comparison = typeof comparison.$inferSelect
export type Score = typeof score.$inferSelect
