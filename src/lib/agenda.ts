import { and, asc, desc, eq, inArray, or } from 'drizzle-orm'
import { db } from '@/db/client'
import { campaign, campaignQuestion, comparison, question, score } from '@/db/schema'
import { IneligibleError, NotFoundError } from '@/lib/errors'

/** A comparison's result from one participant's point of view. Pure. */
export function outcomeFor(
  row: { winnerQuestionId: string | null },
  questionId: string,
): 'won' | 'lost' | 'drew' {
  if (row.winnerQuestionId === null) return 'drew'
  return row.winnerQuestionId === questionId ? 'won' : 'lost'
}

/** The published ranked agenda for a CLOSED campaign. Derived from frozen scores. */
export async function getAgenda(campaignId: string) {
  const [c] = await db.select().from(campaign).where(eq(campaign.id, campaignId)).limit(1)
  if (!c) throw new NotFoundError(`Campaign not found: ${campaignId}`)
  if (c.state !== 'closed') throw new IneligibleError(`Campaign ${campaignId} is not closed (state=${c.state})`)

  // The score table is the authoritative agenda membership: openComparison seeds
  // exactly one score row per campaign_question member before a campaign can reach
  // `comparing`, so these rows are precisely the ranked set.
  const rows = await db
    .select({
      questionId: score.questionId,
      mu: score.mu,
      sigma: score.sigma,
      nComparisons: score.nComparisons,
      canonicalText: question.canonicalText,
    })
    .from(score)
    .innerJoin(question, eq(score.questionId, question.id))
    .where(eq(score.campaignId, campaignId))
    .orderBy(desc(score.mu), asc(score.sigma), asc(score.questionId))

  return {
    campaign: { prompt: c.prompt, comparisonAxis: c.comparisonAxis, closesAt: c.closesAt },
    items: rows.map((r, i) => ({
      rank: i + 1,
      questionId: r.questionId,
      canonicalText: r.canonicalText,
      mu: r.mu,
      sigma: r.sigma,
      nComparisons: r.nComparisons,
    })),
  }
}

/**
 * The comparisons that produced one item's score, from its own perspective.
 * judge_ref is deliberately never selected — anonymous judging stays unlinkable.
 */
export async function getQuestionEvidence(campaignId: string, questionId: string) {
  const [c] = await db.select().from(campaign).where(eq(campaign.id, campaignId)).limit(1)
  if (!c) throw new NotFoundError(`Campaign not found: ${campaignId}`)
  if (c.state !== 'closed') throw new IneligibleError(`Campaign ${campaignId} is not closed (state=${c.state})`)

  const [member] = await db
    .select({ id: campaignQuestion.questionId })
    .from(campaignQuestion)
    .where(and(eq(campaignQuestion.campaignId, campaignId), eq(campaignQuestion.questionId, questionId)))
    .limit(1)
  if (!member) throw new NotFoundError(`Question ${questionId} is not in campaign ${campaignId}`)

  const rows = await db
    .select({
      questionAId: comparison.questionAId,
      questionBId: comparison.questionBId,
      winnerQuestionId: comparison.winnerQuestionId,
      servedReason: comparison.servedReason,
      timestamp: comparison.timestamp,
    })
    .from(comparison)
    .where(
      and(
        eq(comparison.campaignId, campaignId),
        or(eq(comparison.questionAId, questionId), eq(comparison.questionBId, questionId)),
      ),
    )
    // id as a tiebreaker: two comparisons can share a now() timestamp, and we want
    // a stable display order (same precedent as recomputeScores' replay ordering).
    .orderBy(asc(comparison.timestamp), asc(comparison.id))

  const opponentIds = [
    ...new Set(rows.map((r) => (r.questionAId === questionId ? r.questionBId : r.questionAId))),
  ]
  const texts = opponentIds.length
    ? await db
        .select({ id: question.id, canonicalText: question.canonicalText })
        .from(question)
        .where(inArray(question.id, opponentIds))
    : []
  const byId = new Map(texts.map((t) => [t.id, t.canonicalText]))

  return rows.map((r) => {
    const opponentId = r.questionAId === questionId ? r.questionBId : r.questionAId
    return {
      opponentText: byId.get(opponentId) ?? '',
      outcome: outcomeFor(r, questionId),
      servedReason: r.servedReason,
      timestamp: r.timestamp,
    }
  })
}
