import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { question } from '@/db/schema'
import { getActiveWorkspaceId } from '@/lib/workspace'
import { listPublicQuestions } from '@/lib/discovery'
import { THEMES, UNSORTED, isTheme } from '@/lib/themes'

export type RailQuestion = { id: string; canonicalText: string; state: 'canonical' | 'ranked' }
export type TopCampaignQuestion = RailQuestion & {
  campaignId: string
  campaignPrompt: string
  comparisonAxis: string
  closesAt: Date
}
export type MostAskedQuestion = RailQuestion & { clusterSize: number }
export type ThemeCount = { theme: string; count: number }

const PUBLIC_STATES = ['canonical', 'ranked'] as const

/** Most recent canonical/ranked questions — delegates to the discovery list (DRY). */
export async function recentQuestions(limit = 6, workspaceId?: string): Promise<RailQuestion[]> {
  return listPublicQuestions(limit, workspaceId)
}

/**
 * For the most recently CLOSED campaigns, the single highest-mu (winning) question each,
 * labelled with its campaign. One row per campaign; campaign-anchored, not a global score.
 */
export async function topOfRecentCampaigns(
  limit = 6,
  workspaceId?: string,
): Promise<TopCampaignQuestion[]> {
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  const result = await db.execute(sql`
    SELECT * FROM (
      SELECT DISTINCT ON (c.id)
        c.id AS campaign_id, c.prompt, c.comparison_axis, c.closes_at,
        q.id AS question_id, q.canonical_text, q.state
      FROM campaign c
      JOIN score s ON s.campaign_id = c.id
      JOIN question q ON q.id = s.question_id
      WHERE c.workspace_id = ${ws} AND c.state = 'closed' AND q.state IN ('canonical','ranked')
      ORDER BY c.id, s.mu DESC, s.sigma ASC
    ) top
    ORDER BY top.closes_at DESC NULLS LAST
    LIMIT ${limit}
  `)
  return result.rows.map((r) => {
    const row = r as {
      campaign_id: string; prompt: string; comparison_axis: string; closes_at: string
      question_id: string; canonical_text: string; state: string
    }
    return {
      id: row.question_id,
      canonicalText: row.canonical_text,
      state: row.state as 'canonical' | 'ranked',
      campaignId: row.campaign_id,
      campaignPrompt: row.prompt,
      comparisonAxis: row.comparison_axis,
      closesAt: new Date(row.closes_at),
    }
  })
}

/**
 * The clusters with the most canonical/ranked members (a demand signal), each represented by a
 * canonical/ranked member — the stored representative if it qualifies, else the newest member.
 */
export async function mostAskedQuestions(
  limit = 6,
  workspaceId?: string,
): Promise<MostAskedQuestion[]> {
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  const result = await db.execute(sql`
    SELECT * FROM (
      SELECT DISTINCT ON (q.cluster_id)
        q.id AS question_id, q.canonical_text, q.state, cnt.size AS cluster_size
      FROM question q
      JOIN (
        SELECT cluster_id, count(*)::int AS size
        FROM question
        WHERE workspace_id = ${ws} AND cluster_id IS NOT NULL AND state IN ('canonical','ranked')
        GROUP BY cluster_id
      ) cnt ON cnt.cluster_id = q.cluster_id
      LEFT JOIN cluster cl ON cl.id = q.cluster_id
      WHERE q.workspace_id = ${ws} AND q.state IN ('canonical','ranked')
      ORDER BY q.cluster_id, (q.id = cl.representative_question_id) DESC, q.created_at DESC
    ) m
    ORDER BY m.cluster_size DESC, m.question_id
    LIMIT ${limit}
  `)
  return result.rows.map((r) => {
    const row = r as { question_id: string; canonical_text: string; state: string; cluster_size: number }
    return {
      id: row.question_id,
      canonicalText: row.canonical_text,
      state: row.state as 'canonical' | 'ranked',
      clusterSize: Number(row.cluster_size),
    }
  })
}

/** Count of canonical/ranked questions per theme — every THEME zero-filled, plus Unsorted if any. */
export async function themeCounts(workspaceId?: string): Promise<ThemeCount[]> {
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  const rows = await db
    .select({ theme: question.theme, count: sql<number>`count(*)::int` })
    .from(question)
    .where(and(eq(question.workspaceId, ws), inArray(question.state, [...PUBLIC_STATES])))
    .groupBy(question.theme)
  const byTheme = new Map<string, number>()
  let unsorted = 0
  for (const r of rows) {
    if (isTheme(r.theme)) byTheme.set(r.theme, Number(r.count))
    else unsorted += Number(r.count)
  }
  const counts: ThemeCount[] = THEMES.map((t) => ({ theme: t, count: byTheme.get(t) ?? 0 }))
  if (unsorted > 0) counts.push({ theme: UNSORTED, count: unsorted })
  return counts
}

/** Canonical/ranked questions for one theme, newest-first. Unknown theme → empty. */
export async function questionsByTheme(
  theme: string,
  limit = 50,
  workspaceId?: string,
): Promise<RailQuestion[]> {
  if (!isTheme(theme)) return []
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  const rows = await db
    .select({ id: question.id, canonicalText: question.canonicalText, state: question.state })
    .from(question)
    .where(and(eq(question.workspaceId, ws), inArray(question.state, [...PUBLIC_STATES]), eq(question.theme, theme)))
    .orderBy(desc(question.createdAt))
    .limit(limit)
  return rows.map((r) => ({ id: r.id, canonicalText: r.canonicalText, state: r.state as 'canonical' | 'ranked' }))
}
