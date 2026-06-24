import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { campaign, campaignQuestion, comparison, datasetVersion, question, score } from '@/db/schema'
import { addQuestions, closeCampaign, createCampaign, openComparison } from '@/lib/campaign'
import { recordComparison } from '@/lib/comparison'
import { listPublicCampaigns, listPublicQuestions } from '@/lib/discovery'

let versionId: number

function pad(vec: number[]): number[] {
  return [...vec, ...Array(768 - vec.length).fill(0)]
}
async function q(text: string, state: 'submitted' | 'clustered' | 'canonical' | 'under_comparison' | 'ranked'): Promise<string> {
  const [row] = await db
    .insert(question)
    .values({
      rawText: text,
      canonicalText: text,
      embedding: pad([1, 0, 0]),
      embeddingModelVersion: 'test@sha256:test',
      datasetVersionId: versionId,
      submitterRef: 'secret-token',
      visibility: 'public',
      state,
    })
    .returning()
  return row.id
}

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ${comparison} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${score} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${campaignQuestion} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${campaign} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${question} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${datasetVersion} RESTART IDENTITY CASCADE`)
  const [v] = await db
    .insert(datasetVersion)
    .values({ embeddingModel: 'test', embeddingModelDigest: 'sha256:test', embeddingDim: 768 })
    .returning()
  versionId = v.id
})
afterAll(async () => {
  await pool.end()
})

// Drives a campaign to `comparing` (opened) or `closed`.
async function campaignTo(state: 'draft' | 'comparing' | 'closed'): Promise<string> {
  const a = await q('Question A', 'canonical')
  const b = await q('Question B', 'canonical')
  const c = await createCampaign({ prompt: `${state} campaign`, comparisonAxis: 'importance' })
  await addQuestions(c.id, [a, b])
  if (state === 'draft') return c.id
  await openComparison(c.id)
  if (state === 'comparing') return c.id
  await recordComparison({ campaignId: c.id, questionAId: a, questionBId: b, winnerQuestionId: a, judgeRef: 'j1' })
  await closeCampaign(c.id)
  return c.id
}

describe('listPublicCampaigns', () => {
  it('groups closed → published and comparing → openForJudging, with member counts, excluding draft', async () => {
    const closedId = await campaignTo('closed')
    const comparingId = await campaignTo('comparing')
    await campaignTo('draft') // must NOT appear

    const { published, openForJudging } = await listPublicCampaigns()
    expect(published.map((c) => c.id)).toEqual([closedId])
    expect(openForJudging.map((c) => c.id)).toEqual([comparingId])
    expect(published[0].questionCount).toBe(2)
    expect(openForJudging[0].questionCount).toBe(2)
    expect(published[0].closesAt).toBeInstanceOf(Date)
    expect(published[0]).not.toHaveProperty('state')
  })
})

describe('listPublicQuestions', () => {
  it('returns canonical + ranked only, never submitter refs', async () => {
    const canon = await q('canon one', 'canonical')
    const ranked = await q('ranked one', 'ranked')
    await q('pending', 'submitted')
    await q('clustered', 'clustered')
    await q('comparing', 'under_comparison')

    const rows = await listPublicQuestions()
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set([canon, ranked]))
    expect(new Set(rows.map((r) => r.state))).toEqual(new Set(['canonical', 'ranked']))
    expect(rows[0]).not.toHaveProperty('submitterRef')
  })

  it('respects the limit', async () => {
    for (let i = 0; i < 5; i++) await q(`c${i}`, 'canonical')
    expect(await listPublicQuestions(3)).toHaveLength(3)
  })
})
