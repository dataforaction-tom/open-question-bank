import { and, asc, cosineDistance, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { question } from '@/db/schema'

export interface DedupCandidate {
  id: string
  canonicalText: string
  /** Cosine distance from the query (0 = identical, larger = less similar). */
  distance: number
}

/**
 * States eligible to appear as dedup candidates. Excludes `rejected` (moderation
 * removed it), `merged_as_variant` (it's already a variant — the canonical should
 * appear instead), and `flagged` (held for review, not yet accepted into the bank).
 */
const DEDUP_ELIGIBLE_STATES = [
  'submitted',
  'clustered',
  'canonical',
  'under_comparison',
  'ranked',
  'synthesised',
  'archived',
] as const

/**
 * Find existing questions in the given dataset version whose embedding is within
 * `threshold` cosine distance of `embedding`, closest first. Drives "yours or new?".
 * Only questions in relevant states are returned — rejected, merged-as-variant, and
 * flagged questions are excluded.
 */
export async function findNearest(
  embedding: number[],
  datasetVersionId: number,
  threshold: number,
  limit = 5,
): Promise<DedupCandidate[]> {
  const distance = cosineDistance(question.embedding, embedding)
  return db
    .select({
      id: question.id,
      canonicalText: question.canonicalText,
      distance: sql<number>`${distance}`,
    })
    .from(question)
    .where(
      and(
        eq(question.datasetVersionId, datasetVersionId),
        inArray(question.state, [...DEDUP_ELIGIBLE_STATES]),
        isNotNull(question.embedding),
        lt(distance, threshold),
      ),
    )
    .orderBy(asc(distance))
    .limit(limit)
}
