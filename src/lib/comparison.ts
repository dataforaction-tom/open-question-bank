import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { campaign, campaignQuestion, comparison, question, score } from '@/db/schema'
import { IneligibleError, NotFoundError } from '@/lib/errors'
import { initialRating, update, type Rating } from '@/lib/trueskill'
import { selectPair } from '@/lib/pairing'

// The transaction handle Drizzle hands to db.transaction() callbacks — lets
// helpers run inside a transaction without casting away the db type.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function upsertScore(
  tx: Tx,
  campaignId: string,
  questionId: string,
  rating: Rating,
  nComparisons: number,
): Promise<void> {
  const now = new Date()
  await tx
    .insert(score)
    .values({ campaignId, questionId, mu: rating.mu, sigma: rating.sigma, nComparisons, lastUpdated: now })
    .onConflictDoUpdate({
      target: [score.campaignId, score.questionId],
      set: { mu: rating.mu, sigma: rating.sigma, nComparisons, lastUpdated: now },
    })
}

// Map a (winner, A, B) outcome onto a TrueSkill update, returning new A/B ratings.
function applyOutcome(a: Rating, b: Rating, winner: 'a' | 'b' | 'draw'): [Rating, Rating] {
  if (winner === 'draw') return update(a, b, { draw: true })
  if (winner === 'a') return update(a, b)
  // B wins: swap so update() treats B as winner, then swap back to (a, b) order.
  const [nb, na] = update(b, a)
  return [na, nb]
}

export async function nextPair(campaignId: string) {
  const [c] = await db.select().from(campaign).where(eq(campaign.id, campaignId)).limit(1)
  if (!c) throw new NotFoundError(`Campaign not found: ${campaignId}`)
  if (c.state !== 'comparing') throw new IneligibleError(`Campaign ${campaignId} is not comparing (state=${c.state})`)

  const rows = await db
    .select({ questionId: score.questionId, mu: score.mu, sigma: score.sigma })
    .from(score)
    .where(eq(score.campaignId, campaignId))

  const pair = selectPair(rows)
  if (!pair) return null

  const texts = await db
    .select({ id: question.id, canonicalText: question.canonicalText })
    .from(question)
    .where(inArray(question.id, [pair.a.questionId, pair.b.questionId]))
  const byId = new Map(texts.map((t) => [t.id, t.canonicalText]))

  return {
    a: { id: pair.a.questionId, canonicalText: byId.get(pair.a.questionId) ?? '' },
    b: { id: pair.b.questionId, canonicalText: byId.get(pair.b.questionId) ?? '' },
    servedReason: pair.servedReason,
  }
}

export interface RecordComparisonInput {
  campaignId: string
  questionAId: string
  questionBId: string
  winnerQuestionId: string | null // null = draw
  judgeRef: string
  servedReason?: string | null
}

export async function recordComparison(input: RecordComparisonInput) {
  const { campaignId, questionAId, questionBId, winnerQuestionId, judgeRef } = input

  if (questionAId === questionBId) throw new IneligibleError('A question cannot be compared with itself')
  if (winnerQuestionId !== null && winnerQuestionId !== questionAId && winnerQuestionId !== questionBId) {
    throw new IneligibleError('winner must be question A, question B, or null (draw)')
  }

  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(campaign).where(eq(campaign.id, campaignId)).limit(1)
    if (!c) throw new NotFoundError(`Campaign not found: ${campaignId}`)
    if (c.state !== 'comparing') throw new IneligibleError(`Campaign ${campaignId} is not comparing (state=${c.state})`)

    // Verify both questions are members of the campaign.
    const members = await tx
      .select({ questionId: campaignQuestion.questionId })
      .from(campaignQuestion)
      .where(
        and(
          eq(campaignQuestion.campaignId, campaignId),
          inArray(campaignQuestion.questionId, [questionAId, questionBId]),
        ),
      )
    if (members.length !== 2) throw new IneligibleError('Both questions must belong to the campaign')

    // NOTE: READ COMMITTED — concurrent judges could read the same nComparisons and
    // both increment to the same value, under-counting the tally (mu/sigma are still
    // correct, computed from current ratings). Bounded and acceptable for the
    // single-admin tool; recomputeScores can always rebuild the true counts.
    // Append to the immutable comparison log.
    await tx.insert(comparison).values({
      campaignId,
      questionAId,
      questionBId,
      winnerQuestionId,
      judgeRef,
      servedReason: input.servedReason ?? null,
    })

    // Read current ratings (scores may already exist from openComparison).
    const rows = await tx
      .select()
      .from(score)
      .where(and(eq(score.campaignId, campaignId), inArray(score.questionId, [questionAId, questionBId])))
    const init = initialRating()
    const byId = new Map(rows.map((r) => [r.questionId, r]))
    const a = byId.get(questionAId)
    const b = byId.get(questionBId)
    const ratingA: Rating = a ? { mu: a.mu, sigma: a.sigma } : init
    const ratingB: Rating = b ? { mu: b.mu, sigma: b.sigma } : init
    const nA = (a?.nComparisons ?? 0) + 1
    const nB = (b?.nComparisons ?? 0) + 1

    const winner = winnerQuestionId === null ? 'draw' : winnerQuestionId === questionAId ? 'a' : 'b'
    const [newA, newB] = applyOutcome(ratingA, ratingB, winner)

    await upsertScore(tx, campaignId, questionAId, newA, nA)
    await upsertScore(tx, campaignId, questionBId, newB, nB)

    return {
      a: { questionId: questionAId, mu: newA.mu, sigma: newA.sigma, nComparisons: nA },
      b: { questionId: questionBId, mu: newB.mu, sigma: newB.sigma, nComparisons: nB },
    }
  })
}

/** Rebuild every score for a campaign by replaying the append-only log in order. */
export async function recomputeScores(campaignId: string) {
  return db.transaction(async (tx) => {
    const members = await tx
      .select({ questionId: campaignQuestion.questionId })
      .from(campaignQuestion)
      .where(eq(campaignQuestion.campaignId, campaignId))

    const init = initialRating()
    const ratings = new Map(members.map((m) => [m.questionId, { mu: init.mu, sigma: init.sigma, n: 0 }]))

    // Replay the log in insertion order (timestamp then id for strict determinism).
    const log = await tx
      .select()
      .from(comparison)
      .where(eq(comparison.campaignId, campaignId))
      .orderBy(asc(comparison.timestamp), asc(comparison.id))

    for (const row of log) {
      const a = ratings.get(row.questionAId)
      const b = ratings.get(row.questionBId)
      if (!a || !b) continue // member removed; skip
      const winner = row.winnerQuestionId === null ? 'draw' : row.winnerQuestionId === row.questionAId ? 'a' : 'b'
      const [newA, newB] = applyOutcome({ mu: a.mu, sigma: a.sigma }, { mu: b.mu, sigma: b.sigma }, winner)
      ratings.set(row.questionAId, { mu: newA.mu, sigma: newA.sigma, n: a.n + 1 })
      ratings.set(row.questionBId, { mu: newB.mu, sigma: newB.sigma, n: b.n + 1 })
    }

    // Write the replayed scores back to the projection table.
    for (const [questionId, r] of ratings) {
      await upsertScore(tx, campaignId, questionId, { mu: r.mu, sigma: r.sigma }, r.n)
    }

    return [...ratings.entries()].map(([questionId, r]) => ({
      questionId,
      mu: r.mu,
      sigma: r.sigma,
      nComparisons: r.n,
    }))
  })
}
