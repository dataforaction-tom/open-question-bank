import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { campaign, campaignQuestion, comparison, datasetVersion, question, score } from '@/db/schema'
import { POST as createPost, GET as listGet } from '@/app/api/admin/campaigns/route'
import { GET as detailGet } from '@/app/api/admin/campaigns/[id]/route'
import { POST as addPost } from '@/app/api/admin/campaigns/[id]/questions/route'
import { DELETE as removeDelete } from '@/app/api/admin/campaigns/[id]/questions/[questionId]/route'
import { POST as openPost } from '@/app/api/admin/campaigns/[id]/open/route'
import { POST as closePost } from '@/app/api/admin/campaigns/[id]/close/route'
import { GET as pairGet } from '@/app/api/admin/campaigns/[id]/pair/route'
import { POST as comparePost } from '@/app/api/admin/campaigns/[id]/comparisons/route'
import { GET as questionsGet } from '@/app/api/admin/questions/route'

let versionId: number
const MISSING = '00000000-0000-0000-0000-000000000000'
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const jsonReq = (body: unknown) =>
  new Request('http://localhost/test', { method: 'POST', body: JSON.stringify(body) })

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

async function makeCampaign(): Promise<string> {
  const res = await createPost(jsonReq({ prompt: 'p', comparisonAxis: 'importance' }))
  return (await res.json()).campaign.id
}

describe('campaign routes — happy path', () => {
  it('runs create → add → open → pair → compare → close', async () => {
    const a = await q('a')
    const b = await q('b')
    const id = await makeCampaign()

    expect((await listGet()).status).toBe(200)

    const add = await addPost(jsonReq({ questionIds: [a, b] }), ctx(id))
    expect(add.status).toBe(200)

    const detail = await detailGet(new Request('http://localhost/test'), ctx(id))
    expect((await detail.json()).members).toHaveLength(2)

    expect((await openPost(new Request('http://localhost/test'), ctx(id))).status).toBe(200)

    const pair = await pairGet(new Request('http://localhost/test'), ctx(id))
    const pairBody = await pair.json()
    expect(pairBody.pair).not.toBeNull()

    const compare = await comparePost(
      jsonReq({ questionAId: a, questionBId: b, winnerQuestionId: a }),
      ctx(id),
    )
    expect(compare.status).toBe(200)

    expect((await closePost(new Request('http://localhost/test'), ctx(id))).status).toBe(200)
  })
})

describe('campaign routes — errors', () => {
  it('400 on a create with no prompt', async () => {
    expect((await createPost(jsonReq({ comparisonAxis: 'importance' }))).status).toBe(400)
  })
  it('404 on detail for a missing campaign', async () => {
    expect((await detailGet(new Request('http://localhost/test'), ctx(MISSING))).status).toBe(404)
  })
  it('409 opening a campaign with one member', async () => {
    const a = await q('a')
    const id = await makeCampaign()
    await addPost(jsonReq({ questionIds: [a] }), ctx(id))
    expect((await openPost(new Request('http://localhost/test'), ctx(id))).status).toBe(409)
  })
  it('409 recording a comparison before opening', async () => {
    const a = await q('a')
    const b = await q('b')
    const id = await makeCampaign()
    await addPost(jsonReq({ questionIds: [a, b] }), ctx(id))
    const res = await comparePost(jsonReq({ questionAId: a, questionBId: b, winnerQuestionId: a }), ctx(id))
    expect(res.status).toBe(409)
  })
  it('400 on a non-string winnerQuestionId', async () => {
    const a = await q('a')
    const b = await q('b')
    const id = await makeCampaign()
    const res = await comparePost(jsonReq({ questionAId: a, questionBId: b, winnerQuestionId: 42 }), ctx(id))
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/admin/campaigns/[id]/questions/[questionId]', () => {
  it('removes a member while draft', async () => {
    const a = await q('a')
    const id = await makeCampaign()
    await addPost(jsonReq({ questionIds: [a] }), ctx(id))
    const del = await removeDelete(new Request('http://localhost/test', { method: 'DELETE' }), {
      params: Promise.resolve({ id, questionId: a }),
    })
    expect(del.status).toBe(200)
    const detail = await detailGet(new Request('http://localhost/test'), ctx(id))
    expect((await detail.json()).members).toHaveLength(0)
  })
})

describe('GET /api/admin/questions?state=canonical', () => {
  it('200 and lists canonical questions', async () => {
    await q('canon')
    const res = await questionsGet(new Request('http://localhost/api/admin/questions?state=canonical'))
    expect(res.status).toBe(200)
    expect((await res.json()).questions).toHaveLength(1)
  })
})
