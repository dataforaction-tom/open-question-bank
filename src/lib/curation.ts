import { asc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  definednessScore,
  moderationEvent,
  question,
  type DefinednessScore,
  type Question,
} from '@/db/schema'
import { IneligibleError, NotFoundError } from '@/lib/errors'
import { getProvider, type ReasoningProvider } from '@/lib/llm'

/**
 * Run the reasoning LLM's definedness assessment and persist five append-only rows
 * (one per criterion). One INSERT statement = atomic, and all rows share the same
 * now() timestamp — that shared timestamp is how the UI groups scoring runs.
 * Advisory only: never touches state, repeatable at will (spec §4; design §3).
 */
export async function scoreQuestion(
  questionId: string,
  provider: Pick<ReasoningProvider, 'score'> = getProvider(),
): Promise<DefinednessScore[]> {
  const [q] = await db.select().from(question).where(eq(question.id, questionId)).limit(1)
  if (!q) throw new NotFoundError(`Question not found: ${questionId}`)
  if (q.state !== 'clustered') throw new IneligibleError(`Question ${questionId} is not clustered (state=${q.state})`)

  const result = await provider.score(q.canonicalText)
  return db
    .insert(definednessScore)
    .values(
      result.scores.map((s) => ({
        questionId,
        criterion: s.criterion,
        score: s.score,
        rationale: s.rationale,
        model: result.model,
        modelVersion: result.modelVersion,
      })),
    )
    .returning()
}

/** Full score history, oldest first. 404s on an unknown question (no silent empty list). */
export async function listScores(questionId: string): Promise<DefinednessScore[]> {
  const [q] = await db.select({ id: question.id }).from(question).where(eq(question.id, questionId)).limit(1)
  if (!q) throw new NotFoundError(`Question not found: ${questionId}`)
  return db
    .select()
    .from(definednessScore)
    .where(eq(definednessScore.questionId, questionId))
    .orderBy(asc(definednessScore.timestamp))
}

/** Latest row per criterion — the derived "current" view over the append-only history. */
export function currentScores(history: DefinednessScore[]): DefinednessScore[] {
  const latest = new Map<string, DefinednessScore>()
  for (const row of history) latest.set(row.criterion, row) // oldest-first input: later rows win
  return [...latest.values()]
}

/**
 * clustered → canonical (spec §5), audited. The state guard runs inside the transaction,
 * so concurrent promotes cannot double-append audit rows. No scoring precondition —
 * the human stays in control (design §3).
 */
export async function promoteToCanonical(questionId: string, actorRef: string): Promise<Question> {
  return db.transaction(async (tx) => {
    const [q] = await tx.select().from(question).where(eq(question.id, questionId)).limit(1)
    if (!q) throw new NotFoundError(`Question not found: ${questionId}`)
    if (q.state !== 'clustered') throw new IneligibleError(`Question ${questionId} is not clustered (state=${q.state})`)

    await tx.insert(moderationEvent).values({ questionId, action: 'promote', actorRef })
    const [updated] = await tx
      .update(question)
      .set({ state: 'canonical' })
      .where(eq(question.id, questionId))
      .returning()
    return updated
  })
}
