import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { campaign, campaignQuestion, question, score, type Campaign } from '@/db/schema'
import { IneligibleError, NotFoundError } from '@/lib/errors'
import { initialRating, initialRatingWithDemand } from '@/lib/trueskill'
import { getActiveWorkspaceId } from '@/lib/workspace'
import { getVariantCounts } from '@/lib/submission'

// The transaction handle Drizzle hands to db.transaction() callbacks — lets
// helpers run inside a transaction without casting away the db type.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function createCampaign(input: {
  prompt: string
  comparisonAxis: string
  workspaceId?: string
}): Promise<Campaign> {
  const workspaceId = input.workspaceId ?? (await getActiveWorkspaceId())
  const [row] = await db
    .insert(campaign)
    .values({ workspaceId, prompt: input.prompt, comparisonAxis: input.comparisonAxis })
    .returning()
  return row
}

export async function listCampaigns(workspaceId?: string): Promise<Campaign[]> {
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  return db
    .select()
    .from(campaign)
    .where(eq(campaign.workspaceId, ws))
    .orderBy(desc(campaign.createdAt))
}

/** Canonical questions available to add to a campaign. */
export async function listCanonical(limit = 100, workspaceId?: string) {
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  return db
    .select({ id: question.id, canonicalText: question.canonicalText })
    .from(question)
    .where(and(eq(question.state, 'canonical'), eq(question.workspaceId, ws)))
    .orderBy(asc(question.createdAt))
    .limit(limit)
}

/**
 * Fetch a campaign and validate it belongs to the given workspace.
 * Throws NotFoundError if the campaign doesn't exist OR belongs to a different workspace
 * (don't leak existence across workspace boundaries).
 */
export async function requireCampaignInWorkspace(
  campaignId: string,
  workspaceId: string,
): Promise<Campaign> {
  const [c] = await db
    .select()
    .from(campaign)
    .where(and(eq(campaign.id, campaignId), eq(campaign.workspaceId, workspaceId)))
    .limit(1)
  if (!c) throw new NotFoundError(`Campaign not found: ${campaignId}`)
  return c
}

export async function getCampaign(campaignId: string, workspaceId?: string) {
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  const c = await requireCampaignInWorkspace(campaignId, ws)
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

// Curation (add/remove canonical questions, open comparison) is allowed while a campaign is
// `draft` OR `open` for submission — an admin collecting submissions can still build the set.
async function requireCurating(tx: Tx, campaignId: string): Promise<Campaign> {
  const [c] = await tx.select().from(campaign).where(eq(campaign.id, campaignId)).limit(1)
  if (!c) throw new NotFoundError(`Campaign not found: ${campaignId}`)
  if (c.state !== 'draft' && c.state !== 'open') {
    throw new IneligibleError(`Campaign ${campaignId} is not open for curation (state=${c.state})`)
  }
  return c
}

/** Open a draft campaign for public submission (draft → open). */
export async function openForSubmission(
  campaignId: string,
  workspaceId?: string,
): Promise<Campaign> {
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(campaign)
      .where(and(eq(campaign.id, campaignId), eq(campaign.workspaceId, ws)))
      .limit(1)
    if (!c) throw new NotFoundError(`Campaign not found: ${campaignId}`)
    if (c.state !== 'draft') {
      throw new IneligibleError(`Campaign ${campaignId} cannot open for submission (state=${c.state})`)
    }
    const [updated] = await tx
      .update(campaign)
      .set({ state: 'open' })
      .where(eq(campaign.id, campaignId))
      .returning()
    return updated
  })
}

/**
 * Validate that a campaign is accepting public submissions in the given workspace. Throws
 * NotFoundError (unknown / wrong workspace) or IneligibleError (not in the `open` state).
 */
export async function assertCampaignOpenForSubmission(
  campaignId: string,
  workspaceId: string,
): Promise<Campaign> {
  const [c] = await db
    .select()
    .from(campaign)
    .where(and(eq(campaign.id, campaignId), eq(campaign.workspaceId, workspaceId)))
    .limit(1)
  if (!c) throw new NotFoundError(`Campaign not found: ${campaignId}`)
  if (c.state !== 'open') {
    throw new IneligibleError(`Campaign ${campaignId} is not open for submission`)
  }
  return c
}

export async function addQuestions(campaignId: string, questionIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    const c = await requireCurating(tx, campaignId)
    if (questionIds.length === 0) return
    const qs = await tx
      .select({ id: question.id, state: question.state, workspaceId: question.workspaceId })
      .from(question)
      .where(inArray(question.id, questionIds))
    const found = new Map(qs.map((row) => [row.id, row]))
    for (const qid of questionIds) {
      const q = found.get(qid)
      if (!q) throw new NotFoundError(`Question not found: ${qid}`)
      if (q.state !== 'canonical')
        throw new IneligibleError(`Question ${qid} is not canonical (state=${q.state})`)
      // Integrity: never let a question cross the workspace boundary into another's campaign.
      if (q.workspaceId !== c.workspaceId)
        throw new IneligibleError(`Question ${qid} belongs to a different workspace`)
    }
    await tx
      .insert(campaignQuestion)
      .values(questionIds.map((questionId) => ({ campaignId, questionId })))
      .onConflictDoNothing()
  })
}

export async function removeQuestion(campaignId: string, questionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await requireCurating(tx, campaignId)
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
    await requireCurating(tx, campaignId) // draft or open → comparing
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
    // Community demand prior: questions that received more merged submissions
    // start with a higher initial mu (logarithmic boost, sigma unchanged).
    // Pairwise comparisons can still override this — it's a head start, not a floor.
    const variantCounts = await getVariantCounts(members.map((m) => m.id), tx)
    const init = initialRating()
    await tx
      .insert(score)
      .values(
        members.map((m) => {
          const vc = variantCounts.get(m.id) ?? 0
          const rating = vc > 0 ? initialRatingWithDemand(vc) : init
          return { campaignId, questionId: m.id, mu: rating.mu, sigma: rating.sigma }
        }),
      )
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
