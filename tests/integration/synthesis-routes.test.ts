import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { campaign, campaignQuestion, comparison, datasetVersion, question, score, synthesis } from '@/db/schema'
import { addQuestions, closeCampaign, createCampaign, openComparison } from '@/lib/campaign'
import { recordComparison } from '@/lib/comparison'
import { POST as proposePost, GET as listGet } from '@/app/api/admin/campaigns/[id]/syntheses/route'
import { POST as endorsePost } from '@/app/api/admin/campaigns/[id]/syntheses/[synthesisId]/endorse/route'
import { POST as editPost } from '@/app/api/admin/campaigns/[id]/syntheses/[synthesisId]/edit/route'
import { POST as rejectPost } from '@/app/api/admin/campaigns/[id]/syntheses/[synthesisId]/reject/route'
import { GET as publicGet } from '@/app/api/campaigns/[id]/syntheses/route'

let versionId: number
const MISSING = '00000000-0000-0000-0000-000000000000'
const req = () => new Request('http://localhost/test')
const jsonReq = (body: unknown) =>
  new Request('http://localhost/test', { method: 'POST', body: JSON.stringify(body) })
const cctx = (id: string) => ({ params: Promise.resolve({ id }) })
const sctx = (id: string, synthesisId: string) => ({ params: Promise.resolve({ id, synthesisId }) })

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
async function closedCampaign(): Promise<string> {
  const a = await q('Question A')
  const b = await q('Question B')
  const c = await createCampaign({ prompt: 'most important?', comparisonAxis: 'importance' })
  await addQuestions(c.id, [a, b])
  await openComparison(c.id)
  await recordComparison({ campaignId: c.id, questionAId: a, questionBId: b, winnerQuestionId: a, judgeRef: 'j1' })
  await closeCampaign(c.id)
  return c.id
}

beforeEach(async () => {
  vi.stubEnv('REASONING_PROVIDER', 'mock')
  await db.execute(sql`TRUNCATE TABLE ${synthesis} RESTART IDENTITY CASCADE`)
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
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
afterAll(async () => {
  await pool.end()
})

describe('admin synthesis routes', () => {
  it('propose (200, mock) → list → endorse → public shows it', async () => {
    const cid = await closedCampaign()
    const propose = await proposePost(req(), cctx(cid))
    expect(propose.status).toBe(200)
    const { syntheses } = await propose.json()
    expect(syntheses).toHaveLength(1)
    const sid = syntheses[0].id

    expect((await listGet(req(), cctx(cid))).status).toBe(200)

    const endorse = await endorsePost(req(), sctx(cid, sid))
    expect(endorse.status).toBe(200)

    const pub = await publicGet(req(), cctx(cid))
    expect(pub.status).toBe(200)
    const body = await pub.json()
    expect(body.syntheses).toHaveLength(1)
    expect(body.syntheses[0].sources.length).toBeGreaterThan(0)
  })

  it('edit 400 on empty text, 200 with text', async () => {
    const cid = await closedCampaign()
    const sid = (await (await proposePost(req(), cctx(cid))).json()).syntheses[0].id
    expect((await editPost(jsonReq({ text: '' }), sctx(cid, sid))).status).toBe(400)
    expect((await editPost(jsonReq({ text: 'clearer' }), sctx(cid, sid))).status).toBe(200)
  })

  it('reject 200; then endorse 409 (not proposed)', async () => {
    const cid = await closedCampaign()
    const sid = (await (await proposePost(req(), cctx(cid))).json()).syntheses[0].id
    expect((await rejectPost(req(), sctx(cid, sid))).status).toBe(200)
    expect((await endorsePost(req(), sctx(cid, sid))).status).toBe(409)
  })

  it('propose 409 on a non-closed campaign', async () => {
    const a = await q('a')
    const b = await q('b')
    const c = await createCampaign({ prompt: 'p', comparisonAxis: 'importance' })
    await addQuestions(c.id, [a, b])
    await openComparison(c.id)
    expect((await proposePost(req(), cctx(c.id))).status).toBe(409)
  })

  it('propose 502 when the provider is unreachable', async () => {
    vi.stubEnv('REASONING_PROVIDER', 'ollama')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')))
    const cid = await closedCampaign()
    expect((await proposePost(req(), cctx(cid))).status).toBe(502)
  })

  it('public 404 missing, 409 not-closed', async () => {
    expect((await publicGet(req(), cctx(MISSING))).status).toBe(404)
    const a = await q('a')
    const b = await q('b')
    const c = await createCampaign({ prompt: 'p', comparisonAxis: 'importance' })
    await addQuestions(c.id, [a, b])
    await openComparison(c.id)
    expect((await publicGet(req(), cctx(c.id))).status).toBe(409)
  })
})
