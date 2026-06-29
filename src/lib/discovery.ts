import { and, count, desc, eq, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '@/db/client'
import { campaign, campaignQuestion, cluster, question, refinement } from '@/db/schema'
import { NotFoundError } from '@/lib/errors'
import { getActiveWorkspaceId } from '@/lib/workspace'
import { getVariantCount } from '@/lib/submission'

export interface PublicCampaign {
  id: string
  prompt: string
  comparisonAxis: string
  closesAt: Date | null
  questionCount: number
}

type CampaignRow = PublicCampaign & { state: string }

export interface PublicCampaignGroups {
  published: PublicCampaign[] // closed
  openForJudging: PublicCampaign[] // comparing
  openForSubmission: PublicCampaign[] // open
}

/** Split campaign rows into the public groups; drop anything not open/comparing/closed. Pure. */
export function groupPublicCampaigns(rows: CampaignRow[]): PublicCampaignGroups {
  const published: PublicCampaign[] = []
  const openForJudging: PublicCampaign[] = []
  const openForSubmission: PublicCampaign[] = []
  for (const r of rows) {
    const item: PublicCampaign = {
      id: r.id,
      prompt: r.prompt,
      comparisonAxis: r.comparisonAxis,
      closesAt: r.closesAt,
      questionCount: r.questionCount,
    }
    if (r.state === 'closed') published.push(item)
    else if (r.state === 'comparing') openForJudging.push(item)
    else if (r.state === 'open') openForSubmission.push(item)
  }
  return { published, openForJudging, openForSubmission }
}

/**
 * Public campaign index: open (for submission) + comparing (for judging) + closed (published).
 * No drafts, no scores.
 */
export async function listPublicCampaigns(workspaceId?: string): Promise<PublicCampaignGroups> {
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  const rows = await db
    .select({
      id: campaign.id,
      prompt: campaign.prompt,
      comparisonAxis: campaign.comparisonAxis,
      closesAt: campaign.closesAt,
      state: campaign.state,
      questionCount: sql<number>`count(${campaignQuestion.questionId})::int`,
    })
    .from(campaign)
    .leftJoin(campaignQuestion, eq(campaignQuestion.campaignId, campaign.id))
    .where(and(inArray(campaign.state, ['open', 'closed', 'comparing']), eq(campaign.workspaceId, ws)))
    .groupBy(campaign.id)
    .orderBy(desc(campaign.createdAt))
  return groupPublicCampaigns(rows)
}

export interface PublicCampaignInfo {
  id: string
  prompt: string
  comparisonAxis: string
  state: 'open' | 'comparing' | 'closed'
}

/** Public basic info for a single campaign in a public state (open/comparing/closed). */
export async function getPublicCampaign(
  id: string,
  workspaceId?: string,
): Promise<PublicCampaignInfo> {
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  const [c] = await db
    .select({
      id: campaign.id,
      prompt: campaign.prompt,
      comparisonAxis: campaign.comparisonAxis,
      state: campaign.state,
    })
    .from(campaign)
    .where(
      and(
        eq(campaign.id, id),
        eq(campaign.workspaceId, ws),
        inArray(campaign.state, ['open', 'comparing', 'closed']),
      ),
    )
    .limit(1)
  if (!c) throw new NotFoundError(`Campaign not found: ${id}`)
  return { id: c.id, prompt: c.prompt, comparisonAxis: c.comparisonAxis, state: c.state as 'open' | 'comparing' | 'closed' }
}

export interface PublicQuestion {
  id: string
  canonicalText: string
  state: 'canonical' | 'ranked'
}

/** The curated question bank: canonical + ranked questions, newest first, capped. */
export async function listPublicQuestions(
  limit = 200,
  workspaceId?: string,
): Promise<PublicQuestion[]> {
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  const rows = await db
    .select({ id: question.id, canonicalText: question.canonicalText, state: question.state })
    .from(question)
    .where(and(inArray(question.state, ['canonical', 'ranked']), eq(question.workspaceId, ws)))
    .orderBy(desc(question.createdAt))
    .limit(limit)
  return rows.map((r) => ({ id: r.id, canonicalText: r.canonicalText, state: r.state as 'canonical' | 'ranked' }))
}

export interface PublicQuestionDetail {
  id: string
  canonicalText: string
  state: 'canonical' | 'ranked'
  cluster: { id: string; representativeText: string | null; size: number } | null
  campaigns: { id: string; prompt: string; state: 'comparing' | 'closed' }[]
  /** Anonymised lineage summary — counts and criteria only, never actor identity. */
  refinement: { count: number; criteria: string[] }
  /** How many submissions were merged into this question — the community demand signal. */
  variantCount: number
}

/**
 * Public detail for a single published question. Only canonical/ranked questions are visible;
 * the response is strictly anonymised (no submitter ref, no refinement actor) to protect the
 * unlinkability commitment, while still surfacing the transparency the project promises:
 * cluster, campaign membership, and the refinement lineage as counts + criteria.
 */
export async function getPublicQuestion(
  id: string,
  workspaceId?: string,
): Promise<PublicQuestionDetail> {
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  const [q] = await db
    .select({
      id: question.id,
      canonicalText: question.canonicalText,
      state: question.state,
      clusterId: question.clusterId,
    })
    .from(question)
    .where(
      and(
        eq(question.id, id),
        eq(question.workspaceId, ws),
        inArray(question.state, ['canonical', 'ranked']),
      ),
    )
    .limit(1)
  if (!q) throw new NotFoundError(`Question not found: ${id}`)

  let clusterInfo: PublicQuestionDetail['cluster'] = null
  if (q.clusterId) {
    const rep = alias(question, 'rep')
    const [c] = await db
      .select({ representativeText: rep.canonicalText })
      .from(cluster)
      .leftJoin(rep, eq(cluster.representativeQuestionId, rep.id))
      .where(eq(cluster.id, q.clusterId))
      .limit(1)
    const [{ size }] = await db
      .select({ size: count() })
      .from(question)
      .where(
        and(
          eq(question.clusterId, q.clusterId),
          eq(question.workspaceId, ws),
          inArray(question.state, ['canonical', 'ranked']),
        ),
      )
    clusterInfo = {
      id: q.clusterId,
      representativeText: c?.representativeText ?? null,
      size: Number(size),
    }
  }

  const campaigns = await db
    .select({ id: campaign.id, prompt: campaign.prompt, state: campaign.state })
    .from(campaignQuestion)
    .innerJoin(campaign, eq(campaignQuestion.campaignId, campaign.id))
    .where(
      and(
        eq(campaignQuestion.questionId, id),
        eq(campaign.workspaceId, ws),
        inArray(campaign.state, ['comparing', 'closed']),
      ),
    )
    .orderBy(desc(campaign.createdAt))

  const refs = await db
    .select({ criteriaApplied: refinement.criteriaApplied })
    .from(refinement)
    .where(eq(refinement.questionId, id))
  const criteria = [...new Set(refs.flatMap((r) => r.criteriaApplied ?? []))]

  const variantCount = await getVariantCount(id)

  return {
    id: q.id,
    canonicalText: q.canonicalText,
    state: q.state as 'canonical' | 'ranked',
    cluster: clusterInfo,
    campaigns: campaigns.map((cmp) => ({
      id: cmp.id,
      prompt: cmp.prompt,
      state: cmp.state as 'comparing' | 'closed',
    })),
    refinement: { count: refs.length, criteria },
    variantCount,
  }
}
