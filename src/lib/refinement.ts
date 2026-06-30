import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { question, refinement, type Refinement } from '@/db/schema'
import { getProvider, type ReasoningProvider, type RefinementSuggestion } from '@/lib/llm'
import { IneligibleError, NotFoundError } from '@/lib/errors'
import { getActiveWorkspaceId } from '@/lib/workspace'

// Re-exported so existing imports (routes, tests) keep working.
export { IneligibleError, NotFoundError }

/** Questions eligible for refinement: those that have been clustered (spec §5 ordering). */
export async function listClustered(limit = 50, workspaceId?: string) {
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  return db
    .select({ id: question.id, canonicalText: question.canonicalText, createdAt: question.createdAt })
    .from(question)
    .where(and(eq(question.state, 'clustered'), eq(question.workspaceId, ws)))
    .orderBy(asc(question.createdAt))
    .limit(limit)
}

/** Run the reasoning LLM against a clustered question. Does NOT persist anything. */
export async function suggestRefinement(
  questionId: string,
  provider: Pick<ReasoningProvider, 'refine'> = getProvider(),
  workspaceId?: string,
): Promise<{ before: string; suggestion: RefinementSuggestion }> {
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  const [q] = await db
    .select()
    .from(question)
    .where(and(eq(question.id, questionId), eq(question.workspaceId, ws)))
    .limit(1)
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
  /** Active workspace id. If omitted, resolves to the default workspace. */
  workspaceId?: string
}

/**
 * Append the refinement row and, on accept/edit, update canonical_text — in one transaction.
 * Embeddings and state are NOT touched (pinned embedding, spec §8; curation→canonical is Slice 4).
 */
export async function recordRefinement(input: RecordRefinementInput): Promise<Refinement> {
  const ws = input.workspaceId ?? (await getActiveWorkspaceId())
  return db.transaction(async (tx) => {
    const [q] = await tx
      .select()
      .from(question)
      .where(and(eq(question.id, input.questionId), eq(question.workspaceId, ws)))
      .limit(1)
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
export async function listRefinements(questionId: string, workspaceId?: string): Promise<Refinement[]> {
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  // Verify the question exists in this workspace before listing its refinements.
  const [q] = await db
    .select({ id: question.id })
    .from(question)
    .where(and(eq(question.id, questionId), eq(question.workspaceId, ws)))
    .limit(1)
  if (!q) throw new NotFoundError(`Question not found: ${questionId}`)
  return db
    .select()
    .from(refinement)
    .where(eq(refinement.questionId, questionId))
    .orderBy(asc(refinement.timestamp))
}