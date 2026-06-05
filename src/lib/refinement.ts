import { asc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { question, refinement, type Refinement } from '@/db/schema'
import { getProvider, type RefinementProvider, type RefinementSuggestion } from '@/lib/llm'

export class NotFoundError extends Error {}
export class IneligibleError extends Error {}

/** Questions eligible for refinement: those that have been clustered (spec §5 ordering). */
export async function listClustered(limit = 50) {
  return db
    .select({ id: question.id, canonicalText: question.canonicalText, createdAt: question.createdAt })
    .from(question)
    .where(eq(question.state, 'clustered'))
    .orderBy(asc(question.createdAt))
    .limit(limit)
}

/** Run the reasoning LLM against a clustered question. Does NOT persist anything. */
export async function suggestRefinement(
  questionId: string,
  provider: RefinementProvider = getProvider(),
): Promise<{ before: string; suggestion: RefinementSuggestion }> {
  const [q] = await db.select().from(question).where(eq(question.id, questionId)).limit(1)
  if (!q) throw new NotFoundError(`Question not found: ${questionId}`)
  if (q.state !== 'clustered') throw new IneligibleError(`Question ${questionId} is not clustered (state=${q.state})`)
  const suggestion = await provider.refine(q.canonicalText)
  return { before: q.canonicalText, suggestion }
}

export interface RecordRefinementInput {
  questionId: string
  action: 'accept' | 'reject' | 'edit'
  before: string
  llmSuggestedText: string | null
  finalText: string | null // applied text; ignored (stored null) on reject
  criteriaApplied: string[]
  critique: { criterion: string; verdict: 'pass' | 'fail'; note: string }[]
  rationale: string
  model: string | null
  modelVersion: string | null
  actorRef: string
}

/**
 * Append the refinement row and, on accept/edit, update canonical_text — in one transaction.
 * Embeddings and state are NOT touched (pinned embedding, spec §8; curation→canonical is Slice 4).
 */
export async function recordRefinement(input: RecordRefinementInput): Promise<Refinement> {
  return db.transaction(async (tx) => {
    const [q] = await tx.select().from(question).where(eq(question.id, input.questionId)).limit(1)
    if (!q) throw new NotFoundError(`Question not found: ${input.questionId}`)
    if (q.state !== 'clustered') throw new IneligibleError(`Question ${input.questionId} is not clustered (state=${q.state})`)

    const after = input.action === 'reject' ? null : input.finalText

    const [row] = await tx
      .insert(refinement)
      .values({
        questionId: input.questionId,
        before: input.before,
        llmSuggestedText: input.llmSuggestedText,
        after,
        criteriaApplied: input.criteriaApplied,
        critique: input.critique,
        // Always 'llm' this slice; the pure-human (suggested_by='human') path is deferred (design §2).
        suggestedBy: 'llm',
        model: input.model,
        modelVersion: input.modelVersion,
        action: input.action,
        actorRef: input.actorRef,
        rationale: input.rationale,
      })
      .returning()

    if (after !== null) {
      await tx.update(question).set({ canonicalText: after }).where(eq(question.id, input.questionId))
    }
    return row
  })
}

/** Refinement history for a question, oldest first (chronological lineage; transparency view). */
export async function listRefinements(questionId: string): Promise<Refinement[]> {
  return db
    .select()
    .from(refinement)
    .where(eq(refinement.questionId, questionId))
    .orderBy(asc(refinement.timestamp))
}
