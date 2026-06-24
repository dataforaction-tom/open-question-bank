import { desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { campaign, campaignQuestion, question } from '@/db/schema'

export interface PublicCampaign {
  id: string
  prompt: string
  comparisonAxis: string
  closesAt: Date | null
  questionCount: number
}

type CampaignRow = PublicCampaign & { state: string }

/** Split campaign rows into the two public groups; drop anything not closed/comparing. Pure. */
export function groupPublicCampaigns(rows: CampaignRow[]): {
  published: PublicCampaign[]
  openForJudging: PublicCampaign[]
} {
  const published: PublicCampaign[] = []
  const openForJudging: PublicCampaign[] = []
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
  }
  return { published, openForJudging }
}

/** Public campaign index: closed (published) + comparing (open for judging). No drafts, no scores. */
export async function listPublicCampaigns(): Promise<{
  published: PublicCampaign[]
  openForJudging: PublicCampaign[]
}> {
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
    .where(inArray(campaign.state, ['closed', 'comparing']))
    .groupBy(campaign.id)
    .orderBy(desc(campaign.createdAt))
  return groupPublicCampaigns(rows)
}

export interface PublicQuestion {
  id: string
  canonicalText: string
  state: 'canonical' | 'ranked'
}

/** The curated question bank: canonical + ranked questions, newest first, capped. */
export async function listPublicQuestions(limit = 200): Promise<PublicQuestion[]> {
  const rows = await db
    .select({ id: question.id, canonicalText: question.canonicalText, state: question.state })
    .from(question)
    .where(inArray(question.state, ['canonical', 'ranked']))
    .orderBy(desc(question.createdAt))
    .limit(limit)
  return rows.map((r) => ({ id: r.id, canonicalText: r.canonicalText, state: r.state as 'canonical' | 'ranked' }))
}
