import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { campaign, campaignQuestion, comparison, datasetVersion, question, score } from '@/db/schema'
import { addQuestions, closeCampaign, createCampaign, openComparison } from '@/lib/campaign'
import { recordComparison } from '@/lib/comparison'
import { GET as agendaGet } from '@/app/api/campaigns/[id]/agenda/route'
import { GET as evidenceGet } from '@/app/api/campaigns/[id]/agenda/[questionId]/route'

let versionId: number
const MISSING = '00000000-0000-0000-0000-000000000000'
const req = () => new Request('http://localhost/test')
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const ctx2 = (id: string, questionId: string) => ({ params: Promise.resolve({ id, questionId }) })

function pad(vec: number[]): number[] {
  return [...vec, ...Array(768 - vec.length).fill(0)]
}
async function q(text: string): Promise<string> {
  const [row] = await db
    .insert(question)
    .values({
      rawText: text,
      canonicalText: text,
      embedding: pad([1, 0, 0]),
      embeddingModelVersion: 'test@sha256:test',
      datasetVersionId: versionId,
      visibility: 'public',
      state: 'canonical',
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

async function closedCampaign(): Promise<{ cid: string; a: string; b: string }> {
  const a = await q('Question A')
  const b = await q('Question B')
  const c = await createCampaign({ prompt: 'most important?', comparisonAxis: 'importance' })
  await addQuestions(c.id, [a, b])
  await openComparison(c.id)
  await recordComparison({ campaignId: c.id, questionAId: a, questionBId: b, winnerQuestionId: a, judgeRef: 'j1' })
  await closeCampaign(c.id)
  return { cid: c.id, a, b }
}

describe('GET /api/campaigns/[id]/agenda', () => {
  it('200 with ranked items for a closed campaign', async () => {
    const { cid } = await closedCampaign()
    const res = await agendaGet(req(), ctx(cid))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(2)
    expect(body.items[0].rank).toBe(1)
  })

  it('409 for a campaign that is not closed', async () => {
    const a = await q('a')
    const b = await q('b')
    const c = await createCampaign({ prompt: 'p', comparisonAxis: 'importance' })
    await addQuestions(c.id, [a, b])
    await openComparison(c.id)
    expect((await agendaGet(req(), ctx(c.id))).status).toBe(409)
  })

  it('404 for a missing campaign', async () => {
    expect((await agendaGet(req(), ctx(MISSING))).status).toBe(404)
  })
})

describe('GET /api/campaigns/[id]/agenda/[questionId]', () => {
  it('200 with evidence for a closed-campaign member', async () => {
    const { cid, a } = await closedCampaign()
    const res = await evidenceGet(req(), ctx2(cid, a))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.evidence).toHaveLength(1)
    expect(body.evidence[0].outcome).toBe('won')
  })

  it('404 for a non-member question', async () => {
    const { cid } = await closedCampaign()
    const outsider = await q('outsider')
    expect((await evidenceGet(req(), ctx2(cid, outsider))).status).toBe(404)
  })
})
