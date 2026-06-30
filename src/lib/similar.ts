import { and, asc, cosineDistance, eq, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { datasetVersion, question } from '@/db/schema'
import { NotFoundError } from '@/lib/errors'
import { PUBLIC_SEARCH_STATES, type QuestionState } from '@/lib/search'
import { getActiveWorkspaceId } from '@/lib/workspace'

export interface SimilarQuestion {
  id: string
  canonicalText: string
  state: QuestionState
  /** Cosine distance from the source question (0 = identical, larger = less similar). */
  distance: number
}

export interface FindSimilarOptions {
  limit?: number
  /** States BOTH the source and the results may have (defaults to the public set). */
  states?: QuestionState[]
  workspaceId?: string
}

/**
 * Browsable "find similar": nearest neighbours of an existing question, reusing the embeddings
 * already stored for the active dataset version — NO re-embedding, no new model call. Scoped to
 * the source question's dataset version, which keeps results within the same workspace and the
 * same pinned model (the reproducibility commitment).
 */
export async function findSimilarQuestions(
  questionId: string,
  options: FindSimilarOptions = {},
): Promise<SimilarQuestion[]> {
  const limit = Math.min(50, Math.max(1, Math.floor(options.limit ?? 10)))
  const states = options.states ?? PUBLIC_SEARCH_STATES
  if (states.length === 0) return []
  const workspaceId = options.workspaceId ?? (await getActiveWorkspaceId())

  // Scope the SOURCE fetch to the workspace AND the allowed states, so the public endpoint can
  // never pivot "find similar" off an unpublished or cross-workspace question's embedding.
  const [source] = await db
    .select({
      embedding: question.embedding,
      datasetVersionId: question.datasetVersionId,
      similarityThreshold: datasetVersion.similarityThreshold,
    })
    .from(question)
    .innerJoin(datasetVersion, eq(question.datasetVersionId, datasetVersion.id))
    .where(
      and(
        eq(question.id, questionId),
        eq(question.workspaceId, workspaceId),
        inArray(question.state, states),
      ),
    )
    .limit(1)
  if (!source) throw new NotFoundError(`Question not found: ${questionId}`)
  // No vector to compare against (e.g. embedding never computed) → no neighbours rather than error.
  if (!source.embedding) return []

  // Same dataset version ⇒ same workspace and same pinned model (reproducibility); no re-embed.
  const distance = cosineDistance(question.embedding, source.embedding)
  const rows = await db
    .select({
      id: question.id,
      canonicalText: question.canonicalText,
      state: question.state,
      distance: sql<number>`${distance}`,
    })
    .from(question)
    .where(
      and(
        eq(question.datasetVersionId, source.datasetVersionId),
        ne(question.id, questionId),
        inArray(question.state, states),
        // Skip embeddingless rows: their cosine distance is NULL and would otherwise map to 0
        // (a false "perfect match") when the result set is under the limit.
        isNotNull(question.embedding),
        lt(distance, source.similarityThreshold),
      ),
    )
    .orderBy(asc(distance))
    .limit(limit)

  return rows.map((r) => ({
    id: r.id,
    canonicalText: r.canonicalText,
    state: r.state as QuestionState,
    distance: Number(r.distance),
  }))
}
