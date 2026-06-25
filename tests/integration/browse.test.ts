import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import {
  campaign, campaignQuestion, cluster, comparison, datasetVersion, question, score, synthesis,
} from '@/db/schema'
import {
  recentQuestions, topOfRecentCampaigns, mostAskedQuestions, themeCounts, questionsByTheme,
} from '@/lib/browse'
import { THEMES } from '@/lib/themes'

let versionId: number

function pad(vec: number[]): number[] {
  return [...vec, ...Array(768 - vec.length).fill(0)]
}

async function insertQ(opts: {
  text: string
  state: 'submitted' | 'clustered' | 'canonical' | 'ranked' | 'under_comparison'
  theme?: string | null
  clusterId?: string | null
  vec?: number[]
}): Promise<string> {
  const [row] = await db
    .insert(question)
    .values({
      rawText: opts.text,
      canonicalText: opts.text,
      embedding: pad(opts.vec ?? [1, 0, 0]),
      embeddingModelVersion: 'test@sha256:test',
      datasetVersionId: versionId,
      visibility: 'public',
      state: opts.state,
      theme: opts.theme ?? null,
      clusterId: opts.clusterId ?? null,
    })
    .returning()
  return row.id
}

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE
    ${synthesis}, ${score}, ${comparison}, ${campaignQuestion}, ${campaign},
    ${cluster}, ${question}, ${datasetVersion} RESTART IDENTITY CASCADE`)
  const [v] = await db
    .insert(datasetVersion)
    .values({ embeddingModel: 'test', embeddingModelDigest: 'sha256:test', embeddingDim: 768, dedupThreshold: 0.15, clusterThreshold: 0.3 })
    .returning()
  versionId = v.id
})
afterAll(async () => {
  await pool.end()
})

describe('recentQuestions', () => {
  it('returns canonical + ranked newest-first, excludes in-flight states', async () => {
    await insertQ({ text: 'older canonical', state: 'canonical', theme: 'Housing' })
    await insertQ({ text: 'a submitted one', state: 'submitted' })
    await insertQ({ text: 'newer ranked', state: 'ranked', theme: 'Housing' })
    const rows = await recentQuestions(6)
    expect(rows.map((r) => r.canonicalText)).toEqual(['newer ranked', 'older canonical'])
  })
})

describe('topOfRecentCampaigns', () => {
  it('returns the highest-mu question of each closed campaign, newest close first', async () => {
    const winner = await insertQ({ text: 'winner', state: 'ranked', theme: 'Housing' })
    const loser = await insertQ({ text: 'loser', state: 'ranked', theme: 'Housing' })
    const [c] = await db
      .insert(campaign)
      .values({ prompt: 'Budget priorities', comparisonAxis: 'importance', state: 'closed', closesAt: new Date('2026-01-01') })
      .returning()
    await db.insert(score).values([
      { campaignId: c.id, questionId: winner, mu: 30, sigma: 3, nComparisons: 4 },
      { campaignId: c.id, questionId: loser, mu: 20, sigma: 3, nComparisons: 4 },
    ])
    const rows = await topOfRecentCampaigns(6)
    expect(rows).toHaveLength(1)
    expect(rows[0].canonicalText).toBe('winner')
    expect(rows[0].campaignPrompt).toBe('Budget priorities')
    expect(rows[0].comparisonAxis).toBe('importance')
  })
})

describe('mostAskedQuestions', () => {
  it('ranks by canonical/ranked cluster size and shows a canonical member', async () => {
    const [cl] = await db
      .insert(cluster)
      .values({ datasetVersionId: versionId, representativeQuestionId: (await insertQ({ text: 'rep canonical', state: 'canonical', theme: 'Housing' })), thresholdUsed: 0.3 })
      .returning()
    // attach two canonical members to the cluster (including the representative)
    await db.update(question).set({ clusterId: cl.id }).where(sql`${question.canonicalText} = 'rep canonical'`)
    await insertQ({ text: 'second member', state: 'canonical', theme: 'Housing', clusterId: cl.id })
    // a singleton cluster
    const solo = await insertQ({ text: 'solo', state: 'canonical', theme: 'Housing' })
    const [cl2] = await db.insert(cluster).values({ datasetVersionId: versionId, representativeQuestionId: solo, thresholdUsed: 0.3 }).returning()
    await db.update(question).set({ clusterId: cl2.id }).where(sql`${question.id} = ${solo}`)

    const rows = await mostAskedQuestions(6)
    expect(rows[0].clusterSize).toBe(2)
    expect(rows[0].canonicalText).toBe('rep canonical')
    expect(rows.at(-1)?.clusterSize).toBe(1)
  })
})

describe('themeCounts', () => {
  it('includes every theme with zero-fill and an Unsorted bucket', async () => {
    await insertQ({ text: 'h1', state: 'canonical', theme: 'Housing' })
    await insertQ({ text: 'h2', state: 'ranked', theme: 'Housing' })
    await insertQ({ text: 'untagged', state: 'canonical', theme: null })
    const counts = await themeCounts()
    const map = Object.fromEntries(counts.map((c) => [c.theme, c.count]))
    expect(map['Housing']).toBe(2)
    expect(map['Transport & Streets']).toBe(0) // zero-filled
    expect(map['Unsorted']).toBe(1)
    // every fixed theme present
    for (const t of THEMES) expect(t in map).toBe(true)
  })
})

describe('questionsByTheme', () => {
  it('filters canonical/ranked by theme and returns [] for an unknown theme', async () => {
    await insertQ({ text: 'housing q', state: 'canonical', theme: 'Housing' })
    await insertQ({ text: 'transport q', state: 'ranked', theme: 'Transport & Streets' })
    expect((await questionsByTheme('Housing')).map((r) => r.canonicalText)).toEqual(['housing q'])
    expect(await questionsByTheme('Not A Theme')).toEqual([])
  })
})
