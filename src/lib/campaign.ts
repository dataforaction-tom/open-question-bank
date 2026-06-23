import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { campaign, campaignQuestion, question, score, type Campaign } from '@/db/schema'
import { IneligibleError, NotFoundError } from '@/lib/errors'
import { initialRating } from '@/lib/trueskill'

// The transaction handle Drizzle hands to db.transaction() callbacks — lets
// helpers run inside a transaction without casting away the db type.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function createCampaign(input: {
  prompt: string
  comparisonAxis: string
}): Promise<Campaign> {
  const [row] = await db
    .insert(campaign)
    .values({ prompt: input.prompt, comparisonAxis: input.comparisonAxis })
    .returning()
  return row
}

export async function listCampaigns(): Promise<Campaign[]> {
  return db.select().from(campaign).orderBy(desc(campaign.createdAt))
}

/** Canonical questions available to add to a campaign. */
export async function listCanonical(limit = 100) {
  return db
    .select({ id: question.id, canonicalText: question.canonicalText })
    .from(question)
    .where(eq(question.state, 'canonical'))
    .orderBy(asc(question.createdAt))
    .limit(limit)
}

export async function getCampaign(campaignId: string) {
  const [c] = await db.select().from(campaign).where(eq(campaign.id, campaignId)).limit(1)
  if (!c) throw new NotFoundError(`Campaign not found: ${campaignId}`)
  const members = await db
    .select({ id: question.id, canonicalText: question.canonicalText })
    .from(campaignQuestion)
    .innerJoin(question, eq(campaignQuestion.questionId, question.id))
    .where(eq(campaignQuestion.campaignId, campaignId))
    .orderBy(asc(campaignQuestion.addedAt))
  const scores = await db
    .select()
    .from(score)
    .where(eq(score.campaignId, campaignId))
    .orderBy(desc(score.mu))
  return { campaign: c, members, scores }
}

async function requireDraft(tx: Tx, campaignId: string): Promise<Campaign> {
  const [c] = await tx.select().from(campaign).where(eq(campaign.id, campaignId)).limit(1)
  if (!c) throw new NotFoundError(`Campaign not found: ${campaignId}`)
  if (c.state !== 'draft') throw new IneligibleError(`Campaign ${campaignId} is not draft (state=${c.state})`)
  return c
}

export async function addQuestions(campaignId: string, questionIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await requireDraft(tx, campaignId)
    if (questionIds.length === 0) return
    const qs = await tx
      .select({ id: question.id, state: question.state })
      .from(question)
      .where(inArray(question.id, questionIds))
    const found = new Map(qs.map((row) => [row.id, row.state]))
    for (const qid of questionIds) {
      const st = found.get(qid)
      if (!st) throw new NotFoundError(`Question not found: ${qid}`)
      if (st !== 'canonical') throw new IneligibleError(`Question ${qid} is not canonical (state=${st})`)
    }
    await tx
      .insert(campaignQuestion)
      .values(questionIds.map((questionId) => ({ campaignId, questionId })))
      .onConflictDoNothing()
  })
}

export async function removeQuestion(campaignId: string, questionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await requireDraft(tx, campaignId)
    await tx
      .delete(campaignQuestion)
      .where(
        and(eq(campaignQuestion.campaignId, campaignId), eq(campaignQuestion.questionId, questionId)),
      )
  })
}

export async function openComparison(campaignId: string): Promise<Campaign> {
  // NOTE: default READ COMMITTED leaves a narrow TOCTOU window — two concurrent
  // opens sharing a question could both read it as canonical. The under_comparison
  // flip is idempotent so the damage is bounded; a SERIALIZABLE tx or FOR UPDATE on
  // the question rows would close it. Acceptable for the single-admin tool (see spec
  // §11 deferred follow-ups); revisit with multi-user judging in 5b+.
  return db.transaction(async (tx) => {
    await requireDraft(tx, campaignId)
    const members = await tx
      .select({ id: question.id, state: question.state })
      .from(campaignQuestion)
      .innerJoin(question, eq(campaignQuestion.questionId, question.id))
      .where(eq(campaignQuestion.campaignId, campaignId))
    if (members.length < 2) {
      throw new IneligibleError(`Campaign ${campaignId} needs at least 2 questions to open`)
    }
    for (const m of members) {
      // The 5a invariant: a question can be opened into only one comparing campaign at a time.
      if (m.state !== 'canonical') {
        throw new IneligibleError(`Question ${m.id} is not available (state=${m.state})`)
      }
    }
    const init = initialRating()
    await tx
      .insert(score)
      .values(members.map((m) => ({ campaignId, questionId: m.id, mu: init.mu, sigma: init.sigma })))
      .onConflictDoNothing()
    await tx
      .update(question)
      .set({ state: 'under_comparison' })
      .where(inArray(question.id, members.map((m) => m.id)))
    const [updated] = await tx
      .update(campaign)
      .set({ state: 'comparing', opensAt: new Date() })
      .where(eq(campaign.id, campaignId))
      .returning()
    return updated
  })
}

export async function closeCampaign(campaignId: string): Promise<Campaign> {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(campaign).where(eq(campaign.id, campaignId)).limit(1)
    if (!c) throw new NotFoundError(`Campaign not found: ${campaignId}`)
    if (c.state !== 'comparing') {
      throw new IneligibleError(`Campaign ${campaignId} is not comparing (state=${c.state})`)
    }
    const members = await tx
      .select({ questionId: campaignQuestion.questionId })
      .from(campaignQuestion)
      .where(eq(campaignQuestion.campaignId, campaignId))
    if (members.length > 0) {
      await tx
        .update(question)
        .set({ state: 'ranked' })
        .where(
          and(
            inArray(question.id, members.map((m) => m.questionId)),
            eq(question.state, 'under_comparison'),
          ),
        )
    }
    const [updated] = await tx
      .update(campaign)
      .set({ state: 'closed', closesAt: new Date() })
      .where(eq(campaign.id, campaignId))
      .returning()
    return updated
  })
}
