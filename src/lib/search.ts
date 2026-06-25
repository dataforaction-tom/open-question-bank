import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { db } from '@/db/client'
import { campaign, campaignQuestion, definednessScore, question } from '@/db/schema'
import { getActiveWorkspaceId } from '@/lib/workspace'

export type QuestionState =
  | 'submitted'
  | 'flagged'
  | 'rejected'
  | 'merged_as_variant'
  | 'clustered'
  | 'canonical'
  | 'under_comparison'
  | 'ranked'
  | 'synthesised'
  | 'archived'

/** States a member of the public may see in search results (no in-flight or rejected questions). */
export const PUBLIC_SEARCH_STATES: QuestionState[] = ['canonical', 'ranked']

/** Every question state — the admin search may span the whole lifecycle. */
export const ALL_QUESTION_STATES: QuestionState[] = [
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

export type DefinednessBand = 'low' | 'medium' | 'high'

export interface SearchFilters {
  /** Restrict to these question states. Callers MUST pass the allowed set (public vs admin). */
  states: QuestionState[]
  clusterId?: string
  campaignId?: string
  /** Band of the most-recent definedness scoring run's average (1–5 scale). */
  definednessBand?: DefinednessBand
}

export interface SearchParams {
  query: string
  filters: SearchFilters
  page?: number // 0-based
  pageSize?: number
  workspaceId?: string
}

export interface SearchResult {
  id: string
  canonicalText: string
  state: QuestionState
  /** ts_rank relevance score; higher is more relevant. */
  rank: number
}

export interface SearchPage {
  results: SearchResult[]
  page: number
  pageSize: number
  hasMore: boolean
}

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

// Average of the latest definedness run, mapped to coarse bands on the 1–5 rubric scale.
const BAND_RANGE: Record<DefinednessBand, SQL> = {
  low: sql`avg(${definednessScore.score}) < 3`,
  medium: sql`avg(${definednessScore.score}) >= 3 AND avg(${definednessScore.score}) < 4`,
  high: sql`avg(${definednessScore.score}) >= 4`,
}

/**
 * Keyword (full-text) search over canonical question text within a workspace.
 *
 * Uses Postgres `websearch_to_tsquery` (so users can type quotes / OR / -terms naturally),
 * ranked by `ts_rank` over the generated `search_vector` column. Anonymity is preserved: only
 * id / canonical text / state / rank are returned — never submitter refs or embeddings.
 */
export async function searchQuestions(params: SearchParams): Promise<SearchPage> {
  const page = Math.max(0, Math.floor(params.page ?? 0))
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(params.pageSize ?? DEFAULT_PAGE_SIZE)))
  const trimmed = params.query.trim()
  if (trimmed.length === 0) {
    return { results: [], page, pageSize, hasMore: false }
  }
  const workspaceId = params.workspaceId ?? (await getActiveWorkspaceId())
  const { states, clusterId, campaignId, definednessBand } = params.filters
  if (states.length === 0) {
    return { results: [], page, pageSize, hasMore: false }
  }

  const tsquery = sql`websearch_to_tsquery('english', ${trimmed})`
  const rank = sql<number>`ts_rank(${question.searchVector}, ${tsquery})`

  const conditions: SQL[] = [
    eq(question.workspaceId, workspaceId),
    inArray(question.state, states),
    sql`${question.searchVector} @@ ${tsquery}`,
  ]
  if (clusterId) conditions.push(eq(question.clusterId, clusterId))
  if (campaignId) {
    // Workspace-validate the campaign so an out-of-workspace id can't be used as a filter.
    conditions.push(
      sql`${question.id} IN (
        SELECT ${campaignQuestion.questionId} FROM ${campaignQuestion}
        JOIN ${campaign} ON ${campaign.id} = ${campaignQuestion.campaignId}
        WHERE ${campaignQuestion.campaignId} = ${campaignId}
          AND ${campaign.workspaceId} = ${workspaceId}
      )`,
    )
  }
  if (definednessBand) {
    // Filter on the AVERAGE of the question's most-recent scoring run (rows of a run share a
    // timestamp; re-scoring appends a newer run). Append-only tables are only read here.
    conditions.push(
      sql`${question.id} IN (
        SELECT ${definednessScore.questionId} FROM ${definednessScore}
        JOIN (
          SELECT ${definednessScore.questionId} AS qid, MAX(${definednessScore.timestamp}) AS ts
          FROM ${definednessScore} GROUP BY ${definednessScore.questionId}
        ) latest ON latest.qid = ${definednessScore.questionId}
          AND latest.ts = ${definednessScore.timestamp}
        GROUP BY ${definednessScore.questionId}
        HAVING ${BAND_RANGE[definednessBand]}
      )`,
    )
  }

  // Fetch one extra row to determine hasMore without a second COUNT query.
  const rows = await db
    .select({
      id: question.id,
      canonicalText: question.canonicalText,
      state: question.state,
      rank,
    })
    .from(question)
    .where(and(...conditions))
    .orderBy(desc(rank), desc(question.createdAt), desc(question.id))
    .limit(pageSize + 1)
    .offset(page * pageSize)

  const hasMore = rows.length > pageSize
  const results = rows.slice(0, pageSize).map((r) => ({
    id: r.id,
    canonicalText: r.canonicalText,
    state: r.state as QuestionState,
    rank: Number(r.rank),
  }))
  return { results, page, pageSize, hasMore }
}
