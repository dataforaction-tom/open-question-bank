import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '@/db/client'
import { campaign, cluster, comparison, definednessScore, question, refinement } from '@/db/schema'
import { getActiveWorkspaceId } from '@/lib/workspace'

/**
 * Read-only aggregate queries for the dashboards (improvement plan, Phase 4). Every query is
 * workspace-scoped and reads existing tables only — append-only logs are never mutated. Nothing
 * here re-embeds or touches the pinned vector column.
 */

export interface Point {
  label: string
  value: number
}

const DAY = (col: ReturnType<typeof sql>) =>
  sql<string>`to_char(date_trunc('day', ${col}), 'YYYY-MM-DD')`

/** Lifecycle order for the question-state funnel (states not present are simply omitted). */
const STATE_ORDER = [
  'submitted',
  'flagged',
  'rejected',
  'merged_as_variant',
  'clustered',
  'canonical',
  'under_comparison',
  'ranked',
  'synthesised',
  'archived',
]

/** Submissions (new questions) per day over the trailing window. */
export async function submissionsByDay(days = 30, workspaceId?: string): Promise<Point[]> {
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  const day = DAY(sql`${question.createdAt}`)
  const rows = await db
    .select({ label: day, value: sql<number>`count(*)::int` })
    .from(question)
    .where(
      and(eq(question.workspaceId, ws), gte(question.createdAt, sql`now() - make_interval(days => ${days})`)),
    )
    .groupBy(day)
    .orderBy(day)
  return rows.map((r) => ({ label: r.label, value: Number(r.value) }))
}

/** Count of questions in each lifecycle state — the pipeline funnel + moderation queue depth. */
export async function questionStateCounts(workspaceId?: string): Promise<Point[]> {
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  const rows = await db
    .select({ label: question.state, value: sql<number>`count(*)::int` })
    .from(question)
    .where(eq(question.workspaceId, ws))
    .groupBy(question.state)
  const byState = new Map(rows.map((r) => [r.label as string, Number(r.value)]))
  return STATE_ORDER.filter((s) => byState.has(s)).map((s) => ({ label: s, value: byState.get(s)! }))
}

/** The largest clusters, labelled by their representative question. */
export async function clusterSizes(limit = 10, workspaceId?: string): Promise<Point[]> {
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  const rep = alias(question, 'rep')
  const countExpr = sql<number>`count(${question.id})::int`
  const rows = await db
    .select({
      label: sql<string>`coalesce(${rep.canonicalText}, left(${cluster.id}::text, 8))`,
      value: countExpr,
    })
    .from(question)
    .innerJoin(cluster, eq(question.clusterId, cluster.id))
    .leftJoin(rep, eq(cluster.representativeQuestionId, rep.id))
    .where(and(eq(question.workspaceId, ws), isNotNull(question.clusterId)))
    .groupBy(cluster.id, rep.canonicalText)
    .orderBy(desc(countExpr))
    .limit(limit)
  return rows.map((r) => ({ label: r.label, value: Number(r.value) }))
}

/** Distribution of questions across definedness bands (latest scoring-run average, 1–5). */
export async function definednessBands(workspaceId?: string): Promise<Point[]> {
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  const result = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE avg_score < 3)::int AS low,
      count(*) FILTER (WHERE avg_score >= 3 AND avg_score < 4)::int AS medium,
      count(*) FILTER (WHERE avg_score >= 4)::int AS high
    FROM (
      SELECT ds.question_id, avg(ds.score) AS avg_score
      FROM ${definednessScore} ds
      JOIN ${question} q ON q.id = ds.question_id AND q.workspace_id = ${ws}
      JOIN (
        SELECT question_id, max(timestamp) AS ts FROM ${definednessScore} GROUP BY question_id
      ) latest ON latest.question_id = ds.question_id AND latest.ts = ds.timestamp
      GROUP BY ds.question_id
    ) per_question
  `)
  const row = (result.rows[0] ?? { low: 0, medium: 0, high: 0 }) as {
    low: number
    medium: number
    high: number
  }
  return [
    { label: 'Low', value: Number(row.low) },
    { label: 'Medium', value: Number(row.medium) },
    { label: 'High', value: Number(row.high) },
  ]
}

/** Refinement records per day (throughput of the LLM-assisted refinement log). */
export async function refinementsByDay(days = 30, workspaceId?: string): Promise<Point[]> {
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  const day = DAY(sql`${refinement.timestamp}`)
  const rows = await db
    .select({ label: day, value: sql<number>`count(*)::int` })
    .from(refinement)
    .innerJoin(question, eq(refinement.questionId, question.id))
    .where(
      and(eq(question.workspaceId, ws), gte(refinement.timestamp, sql`now() - make_interval(days => ${days})`)),
    )
    .groupBy(day)
    .orderBy(day)
  return rows.map((r) => ({ label: r.label, value: Number(r.value) }))
}

/** Comparisons (judgements) recorded per day. */
export async function comparisonsByDay(days = 30, workspaceId?: string): Promise<Point[]> {
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  const day = DAY(sql`${comparison.timestamp}`)
  const rows = await db
    .select({ label: day, value: sql<number>`count(*)::int` })
    .from(comparison)
    .innerJoin(campaign, eq(comparison.campaignId, campaign.id))
    .where(
      and(eq(campaign.workspaceId, ws), gte(comparison.timestamp, sql`now() - make_interval(days => ${days})`)),
    )
    .groupBy(day)
    .orderBy(day)
  return rows.map((r) => ({ label: r.label, value: Number(r.value) }))
}

export interface PipelineTotals {
  questions: number
  pending: number // submitted + flagged (moderation queue depth)
  canonical: number
  ranked: number
  campaigns: number
  comparisons: number
}

/** Headline counters for the dashboard top row. */
export async function pipelineTotals(workspaceId?: string): Promise<PipelineTotals> {
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  const [q] = await db
    .select({
      questions: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) FILTER (WHERE ${question.state} IN ('submitted','flagged'))::int`,
      canonical: sql<number>`count(*) FILTER (WHERE ${question.state} = 'canonical')::int`,
      ranked: sql<number>`count(*) FILTER (WHERE ${question.state} = 'ranked')::int`,
    })
    .from(question)
    .where(eq(question.workspaceId, ws))
  const [c] = await db
    .select({ campaigns: sql<number>`count(*)::int` })
    .from(campaign)
    .where(eq(campaign.workspaceId, ws))
  const [cmp] = await db
    .select({ comparisons: sql<number>`count(*)::int` })
    .from(comparison)
    .innerJoin(campaign, eq(comparison.campaignId, campaign.id))
    .where(eq(campaign.workspaceId, ws))
  return {
    questions: Number(q?.questions ?? 0),
    pending: Number(q?.pending ?? 0),
    canonical: Number(q?.canonical ?? 0),
    ranked: Number(q?.ranked ?? 0),
    campaigns: Number(c?.campaigns ?? 0),
    comparisons: Number(cmp?.comparisons ?? 0),
  }
}
