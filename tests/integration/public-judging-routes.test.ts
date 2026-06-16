import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { campaign, campaignQuestion, comparison, datasetVersion, question, score } from '@/db/schema'
import { createCampaign, addQuestions, openComparison } from '@/lib/campaign'
import { JUDGE_COOKIE } from '@/lib/judge'
import { GET as pairGet } from '@/app/api/campaigns/[id]/pair/route'
import { POST as comparePost } from '@/app/api/campaigns/[id]/comparisons/route'

let versionId: number
const MISSING = '00000000-0000-0000-0000-000000000000'
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const get = (cookie?: string) =>
  new Request('http://localhost/test', cookie ? { headers: { cookie } } : undefined)
const post = (body: unknown, cookie?: string) =>
  new Request('http://localhost/test', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: cookie ? { cookie } : undefined,
  })

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
async function openCampaignWith(ids: string[]): Promise<string> {
  const c = await createCampaign({ prompt: 'most important?', comparisonAxis: 'importance' })
  await addQuestions(c.id, ids)
  await openComparison(c.id)
  return c.id
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

describe('GET /api/campaigns/[id]/pair', () => {
  it('200: returns campaign info + a pair and sets the judge cookie', async () => {
    const a = await q('a')
    const b = await q('b')
    const cid = await openCampaignWith([a, b])
    const res = await pairGet(get(), ctx(cid))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.campaign.comparisonAxis).toBe('importance')
    expect(body.pair).not.toBeNull()
    expect(res.cookies.get(JUDGE_COOKIE)?.value).toBeTruthy()
  })

  it('409 when the campaign is not comparing', async () => {
    const c = await createCampaign({ prompt: 'p', comparisonAxis: 'importance' })
    expect((await pairGet(get(), ctx(c.id))).status).toBe(409)
  })

  it('404 for an unknown campaign', async () => {
    expect((await pairGet(get(), ctx(MISSING))).status).toBe(404)
  })

  it('does not re-set the cookie when the judge already has one', async () => {
    const a = await q('a')
    const b = await q('b')
    const cid = await openCampaignWith([a, b])
    const res = await pairGet(get(`${JUDGE_COOKIE}=existing-ref`), ctx(cid))
    expect(res.status).toBe(200)
    expect(res.cookies.get(JUDGE_COOKIE)).toBeUndefined()
  })
})

describe('POST /api/campaigns/[id]/comparisons', () => {
  it('200: records under the cookie token, 409 on a repeat', async () => {
    const a = await q('a')
    const b = await q('b')
    const cid = await openCampaignWith([a, b])
    const cookie = `${JUDGE_COOKIE}=judge-1`
    const first = await comparePost(post({ questionAId: a, questionBId: b, winnerQuestionId: a }, cookie), ctx(cid))
    expect(first.status).toBe(200)
    const repeat = await comparePost(post({ questionAId: a, questionBId: b, winnerQuestionId: b }, cookie), ctx(cid))
    expect(repeat.status).toBe(409)
    const rows = await db.select().from(comparison)
    expect(rows).toHaveLength(1)
    expect(rows[0].judgeRef).toBe('judge-1')
  })

  it('400 on a non-string winnerQuestionId', async () => {
    const a = await q('a')
    const b = await q('b')
    const cid = await openCampaignWith([a, b])
    const res = await comparePost(post({ questionAId: a, questionBId: b, winnerQuestionId: 5 }), ctx(cid))
    expect(res.status).toBe(400)
  })

  it('409 (generic) when posting to a campaign that is not comparing', async () => {
    const a = await q('a')
    const b = await q('b')
    const c = await createCampaign({ prompt: 'p', comparisonAxis: 'importance' })
    await addQuestions(c.id, [a, b]) // still draft — never opened
    const res = await comparePost(post({ questionAId: a, questionBId: b, winnerQuestionId: a }), ctx(c.id))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('That comparison could not be recorded')
  })

  it('400 on a malformed/empty body', async () => {
    const cid = await openCampaignWith([await q('a'), await q('b')])
    const res = await comparePost(new Request('http://localhost/test', { method: 'POST' }), ctx(cid))
    expect(res.status).toBe(400)
  })
})
