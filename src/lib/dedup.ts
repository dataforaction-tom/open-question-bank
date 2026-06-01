import { and, asc, cosineDistance, eq, lt, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { question } from '@/db/schema'

export interface DedupCandidate {
  id: string
  canonicalText: string
  /** Cosine distance from the query (0 = identical, larger = less similar). */
  distance: number
}

/**
 * Find existing questions in the given dataset version whose embedding is within
 * `threshold` cosine distance of `embedding`, closest first. Drives "yours or new?".
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
    .where(and(eq(question.datasetVersionId, datasetVersionId), lt(distance, threshold)))
    .orderBy(asc(distance))
    .limit(limit)
}
