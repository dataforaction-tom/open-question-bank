import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import {
  campaign,
  campaignQuestion,
  cluster,
  comparison,
  datasetVersion,
  definednessScore,
  question,
  score,
} from '@/db/schema'
import { searchQuestions, PUBLIC_SEARCH_STATES, ALL_QUESTION_STATES } from '@/lib/search'
import { ensureDefaultWorkspace, DEFAULT_WORKSPACE_ID } from '@/lib/workspace'

let versionId: number

function pad(vec: number[]): number[] {
  return [...vec, ...Array(768 - vec.length).fill(0)]
}

type State = (typeof ALL_QUESTION_STATES)[number]

async function q(text: string, state: State = 'canonical'): Promise<string> {
  const [row] = await db
    .insert(question)
    .values({
      rawText: text,
      canonicalText: text,
      embedding: pad([1, 0, 0]),
      embeddingModelVersion: 'test@sha256:test',
      workspaceId: DEFAULT_WORKSPACE_ID,
      datasetVersionId: versionId,
      submitterRef: 'secret-token',
      visibility: 'public',
      state,
    })
    .returning()
  return row.id
}

/** Insert one definedness run (five criterion rows sharing a timestamp). */
async function scoreRun(questionId: string, value: number) {
  const criteria = ['specific', 'answerable', 'scoped', 'non-leading', 'single-barrelled'] as const
  await db.insert(definednessScore).values(
    criteria.map((criterion) => ({
      questionId,
      criterion,
      score: value,
      rationale: 'test',
      model: 'test',
      modelVersion: 'test',
    })),
  )
}

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ${definednessScore} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${comparison} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${score} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${campaignQuestion} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${campaign} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${cluster} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${question} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${datasetVersion} RESTART IDENTITY CASCADE`)
  await ensureDefaultWorkspace()
  const [v] = await db
    .insert(datasetVersion)
    .values({ embeddingModel: 'test', embeddingModelDigest: 'sha256:test', embeddingDim: 768 })
    .returning()
  versionId = v.id
})
afterAll(async () => {
  await pool.end()
})

const publicFilters = { states: PUBLIC_SEARCH_STATES }

describe('searchQuestions — matching & ranking', () => {
  it('returns full-text matches and ranks denser matches higher', async () => {
    const dense = await q('resilience resilience resilience in our community')
    await q('a single mention of resilience among budgets')
    await q('completely unrelated text about parking')

    const { results } = await searchQuestions({ query: 'resilience', filters: publicFilters })
    expect(results).toHaveLength(2)
    expect(results[0].id).toBe(dense) // higher term frequency ⇒ higher ts_rank
    expect(results.every((r) => r.rank > 0)).toBe(true)
  })

  it('supports websearch operators (quoted phrase, exclusion)', async () => {
    const phrase = await q('climate adaptation funding for towns')
    await q('adaptation of legacy software systems')

    const quoted = await searchQuestions({ query: '"climate adaptation"', filters: publicFilters })
    expect(quoted.results.map((r) => r.id)).toEqual([phrase])
  })

  it('returns nothing for an empty query', async () => {
    await q('resilience matters')
    const { results, hasMore } = await searchQuestions({ query: '   ', filters: publicFilters })
    expect(results).toEqual([])
    expect(hasMore).toBe(false)
  })

  it('never leaks submitter identity', async () => {
    await q('resilience and identity')
    const { results } = await searchQuestions({ query: 'resilience', filters: publicFilters })
    expect(results[0]).not.toHaveProperty('submitterRef')
    expect(Object.keys(results[0]).sort()).toEqual(['canonicalText', 'id', 'rank', 'state'])
  })
})

describe('searchQuestions — filters', () => {
  it('restricts to the caller-supplied states (public hides in-flight questions)', async () => {
    const canon = await q('resilience canonical', 'canonical')
    await q('resilience submitted', 'submitted') // must not appear publicly

    const pub = await searchQuestions({ query: 'resilience', filters: publicFilters })
    expect(pub.results.map((r) => r.id)).toEqual([canon])

    const admin = await searchQuestions({ query: 'resilience', filters: { states: ALL_QUESTION_STATES } })
    expect(admin.results).toHaveLength(2)
  })

  it('filters by cluster', async () => {
    const inCluster = await q('resilience clustered')
    const elsewhere = await q('resilience elsewhere')
    const [cl] = await db
      .insert(cluster)
      .values({ datasetVersionId: versionId, representativeQuestionId: inCluster, thresholdUsed: 0.2 })
      .returning()
    await db.update(question).set({ clusterId: cl.id }).where(eq(question.id, inCluster))

    const { results } = await searchQuestions({
      query: 'resilience',
      filters: { ...publicFilters, clusterId: cl.id },
    })
    expect(results.map((r) => r.id)).toEqual([inCluster])
    expect(results.map((r) => r.id)).not.toContain(elsewhere)
  })

  it('filters by campaign membership', async () => {
    const member = await q('resilience in campaign')
    await q('resilience not in campaign')
    const [c] = await db
      .insert(campaign)
      .values({ prompt: 'p', comparisonAxis: 'importance' })
      .returning()
    await db.insert(campaignQuestion).values({ campaignId: c.id, questionId: member })

    const { results } = await searchQuestions({
      query: 'resilience',
      filters: { ...publicFilters, campaignId: c.id },
    })
    expect(results.map((r) => r.id)).toEqual([member])
  })

  it('filters by definedness band (latest run average)', async () => {
    const high = await q('resilience well defined')
    const low = await q('resilience poorly defined')
    await scoreRun(high, 5) // avg 5 ⇒ high
    await scoreRun(low, 1) // avg 1 ⇒ low

    const highBand = await searchQuestions({
      query: 'resilience',
      filters: { ...publicFilters, definednessBand: 'high' },
    })
    expect(highBand.results.map((r) => r.id)).toEqual([high])

    const lowBand = await searchQuestions({
      query: 'resilience',
      filters: { ...publicFilters, definednessBand: 'low' },
    })
    expect(lowBand.results.map((r) => r.id)).toEqual([low])
  })
})

describe('searchQuestions — pagination', () => {
  it('pages with a hasMore flag', async () => {
    for (let i = 0; i < 3; i++) await q(`resilience number ${i}`)

    const page0 = await searchQuestions({ query: 'resilience', filters: publicFilters, page: 0, pageSize: 2 })
    expect(page0.results).toHaveLength(2)
    expect(page0.hasMore).toBe(true)

    const page1 = await searchQuestions({ query: 'resilience', filters: publicFilters, page: 1, pageSize: 2 })
    expect(page1.results).toHaveLength(1)
    expect(page1.hasMore).toBe(false)
  })
})
