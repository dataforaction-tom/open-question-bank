import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { question, type Question } from '@/db/schema'
import { embedForActiveVersion } from '@/lib/embedding'
import { findNearest, type DedupCandidate } from '@/lib/dedup'
import { assertCampaignOpenForSubmission } from '@/lib/campaign'

export interface SubmitInput {
  rawText: string
  visibility: 'anonymous' | 'public'
  submitterRef?: string | null
  /** Optional campaign this question is submitted INTO — a curation signal only (Phase 3). */
  originatingCampaignId?: string | null
}

export interface PrepareResult {
  status: 'created' | 'candidates'
  question?: { id: string; canonicalText: string }
  candidates?: DedupCandidate[]
  /** The embedding computed during dedup, so the decision call can skip re-embedding. */
  embedding?: number[]
  embeddingModelVersion?: string
  workspaceId?: string
  datasetVersionId?: number
}

/**
 * Dedup-at-source entry point. Embeds the text, looks for near matches, and either
 * returns candidates ("yours or new?") or — when nothing is close — creates the question.
 */
export async function prepareSubmission(input: SubmitInput): Promise<PrepareResult> {
  const { embedding, embeddingModelVersion, workspaceId, datasetVersionId, dedupThreshold } =
    await embedForActiveVersion(input.rawText)

  // If submitting into a campaign, it must be open for submission in this workspace.
  if (input.originatingCampaignId) {
    await assertCampaignOpenForSubmission(input.originatingCampaignId, workspaceId)
  }

  // Dedup is scoped to this dataset version, which belongs to exactly one workspace, so
  // candidates can only come from the same workspace.
  const candidates = await findNearest(embedding, datasetVersionId, dedupThreshold)
  if (candidates.length > 0) {
    // Return the embedding so the decision call (createQuestion) can skip re-embedding.
    return {
      status: 'candidates',
      candidates,
      embedding,
      embeddingModelVersion,
      workspaceId,
      datasetVersionId,
    }
  }

  const created = await insertQuestion(input, {
    embedding,
    embeddingModelVersion,
    workspaceId,
    datasetVersionId,
    state: 'submitted',
  })
  return { status: 'created', question: { id: created.id, canonicalText: created.canonicalText } }
}

/**
 * Persist a question after the submitter has decided. With `mergeInto`, store it as a
 * variant of the chosen canonical question; otherwise store it as a fresh submission.
 * If `precomputed` is supplied (from a prior `prepareSubmission` call), the text is
 * NOT re-embedded — the same vector and provenance are reused, avoiding a double Ollama call.
 */
export async function createQuestion(
  input: SubmitInput,
  options: {
    mergeInto?: string
    precomputed?: {
      embedding: number[]
      embeddingModelVersion: string
      workspaceId: string
      datasetVersionId: number
    }
  } = {},
): Promise<Question> {
  const { embedding, embeddingModelVersion, workspaceId, datasetVersionId } =
    options.precomputed ?? (await embedForActiveVersion(input.rawText))
  if (input.originatingCampaignId) {
    await assertCampaignOpenForSubmission(input.originatingCampaignId, workspaceId)
  }
  return insertQuestion(input, {
    embedding,
    embeddingModelVersion,
    workspaceId,
    datasetVersionId,
    state: options.mergeInto ? 'merged_as_variant' : 'submitted',
    canonicalOf: options.mergeInto,
  })
}

async function insertQuestion(
  input: SubmitInput,
  fields: {
    embedding: number[]
    embeddingModelVersion: string
    workspaceId: string
    datasetVersionId: number
    state: 'submitted' | 'merged_as_variant'
    canonicalOf?: string
  },
): Promise<Question> {
  const [row] = await db
    .insert(question)
    .values({
      rawText: input.rawText,
      canonicalText: input.rawText, // canonical starts equal to raw; refinements come later
      embedding: fields.embedding,
      embeddingModelVersion: fields.embeddingModelVersion,
      workspaceId: fields.workspaceId,
      datasetVersionId: fields.datasetVersionId,
      submitterRef: input.submitterRef ?? null,
      visibility: input.visibility,
      state: fields.state,
      canonicalOf: fields.canonicalOf ?? null,
      originatingCampaignId: input.originatingCampaignId ?? null,
    })
    .returning()
  return row
}

/**
 * Count how many submissions were merged as variants of the given canonical question.
 * This is the "community demand" signal: when multiple people independently submit
 * questions that all merge into one canonical, that question carries more weight.
 * Returns 0 for questions with no variants.
 */
export async function getVariantCount(
  questionId: string,
  tx?: Pick<typeof db, 'select'>,
): Promise<number> {
  const client = tx ?? db
  const [row] = await client
    .select({ count: sql<number>`count(*)::int` })
    .from(question)
    .where(
      and(
        eq(question.canonicalOf, questionId),
        eq(question.state, 'merged_as_variant'),
      ),
    )
  return Number(row?.count ?? 0)
}

/**
 * Count variants for multiple questions in a single query. Returns a Map of
 * questionId → variant count. More efficient than calling getVariantCount in a loop.
 */
export async function getVariantCounts(
  questionIds: string[],
  tx?: Pick<typeof db, 'select'>,
): Promise<Map<string, number>> {
  if (questionIds.length === 0) return new Map()
  const client = tx ?? db
  const rows = await client
    .select({
      canonicalOf: question.canonicalOf,
      count: sql<number>`count(*)::int`,
    })
    .from(question)
    .where(
      and(
        inArray(question.canonicalOf, questionIds),
        eq(question.state, 'merged_as_variant'),
      ),
    )
    .groupBy(question.canonicalOf)
  return new Map(rows.map((r) => [r.canonicalOf!, Number(r.count)]))
}
