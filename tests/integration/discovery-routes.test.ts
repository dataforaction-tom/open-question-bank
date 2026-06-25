import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { campaign, campaignQuestion, comparison, datasetVersion, question, score } from '@/db/schema'
import { addQuestions, createCampaign, openComparison } from '@/lib/campaign'
import { GET as campaignsGet } from '@/app/api/campaigns/route'
import { GET as questionsGet, POST as questionsPost } from '@/app/api/questions/route'

let versionId: number
const jsonReq = (body: unknown) =>
  new Request('http://localhost/test', { method: 'POST', body: JSON.stringify(body) })

function pad(vec: number[]): number[] {
  return [...vec, ...Array(768 - vec.length).fill(0)]
}
async function q(text: string, state: 'submitted' | 'canonical'): Promise<string> {
  const [row] = await db
    .insert(question)
    .values({
      rawText: text,
      canonicalText: text,
      embedding: pad([1, 0, 0]),
      embeddingModelVersion: 'test@sha256:test',
      datasetVersionId: versionId,
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

describe('GET /api/campaigns', () => {
  it('200 with the public groups (empty when nothing open/closed/comparing)', async () => {
    const res = await campaignsGet()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ published: [], openForJudging: [], openForSubmission: [] })
  })

  it('lists a comparing campaign under openForJudging', async () => {
    const a = await q('a', 'canonical')
    const b = await q('b', 'canonical')
    const c = await createCampaign({ prompt: 'p', comparisonAxis: 'importance' })
    await addQuestions(c.id, [a, b])
    await openComparison(c.id)
    const body = await (await campaignsGet()).json()
    expect(body.openForJudging.map((x: { id: string }) => x.id)).toEqual([c.id])
  })
})

describe('GET /api/questions (browse)', () => {
  it('200 with canonical/ranked questions only', async () => {
    await q('canon', 'canonical')
    await q('pending', 'submitted') // excluded
    const res = await questionsGet()
    expect(res.status).toBe(200)
    const { questions } = await res.json()
    expect(questions).toHaveLength(1)
    expect(questions[0].state).toBe('canonical')
  })
})

describe('POST /api/questions still works (submit untouched)', () => {
  it('400 on an invalid body (no embedding call needed)', async () => {
    const res = await questionsPost(jsonReq({ visibility: 'public' })) // missing rawText
    expect(res.status).toBe(400)
  })
})
