import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { datasetVersion, definednessScore, moderationEvent, question } from '@/db/schema'
import { POST as scorePost } from '@/app/api/admin/questions/[id]/score/route'
import { GET as scoresGet } from '@/app/api/admin/questions/[id]/scores/route'
import { POST as promotePost } from '@/app/api/admin/questions/[id]/promote/route'

let versionId: number

function pad(vec: number[]): number[] {
  return [...vec, ...Array(768 - vec.length).fill(0)]
}

async function insert(text: string, state: 'submitted' | 'clustered'): Promise<string> {
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

function ctx(id: string) {
  return { params: Promise.resolve({ id }) }
}

const REQ = new Request('http://localhost/test')
const MISSING_ID = '00000000-0000-0000-0000-000000000000'

beforeEach(async () => {
  vi.stubEnv('REASONING_PROVIDER', 'mock')
  await db.execute(sql`TRUNCATE TABLE ${definednessScore} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${moderationEvent} RESTART IDENTITY CASCADE`)
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

describe('POST /api/admin/questions/[id]/score', () => {
  it('200: persists and returns the five mock rows', async () => {
    const id = await insert('How do we fix education?', 'clustered')
    const res = await scorePost(REQ, ctx(id))
    expect(res.status).toBe(200)
    const { scores } = await res.json()
    expect(scores).toHaveLength(5)
    expect(scores[0].model).toBe('mock')
  })

  it('404 for a missing question', async () => {
    expect((await scorePost(REQ, ctx(MISSING_ID))).status).toBe(404)
  })

  it('409 for a non-clustered question', async () => {
    const id = await insert('pending', 'submitted')
    expect((await scorePost(REQ, ctx(id))).status).toBe(409)
  })

  it('502 when the provider is unreachable, and writes nothing', async () => {
    vi.stubEnv('REASONING_PROVIDER', 'ollama')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')))
    const id = await insert('How do we fix education?', 'clustered')
    expect((await scorePost(REQ, ctx(id))).status).toBe(502)
    expect(await db.select().from(definednessScore)).toHaveLength(0)
  })
})

describe('GET /api/admin/questions/[id]/scores', () => {
  it('200: returns current (latest per criterion) and full history', async () => {
    const id = await insert('How do we fix education?', 'clustered')
    await scorePost(REQ, ctx(id))
    await scorePost(REQ, ctx(id)) // re-score appends
    const res = await scoresGet(REQ, ctx(id))
    expect(res.status).toBe(200)
    const { current, history } = await res.json()
    expect(current).toHaveLength(5)
    expect(history).toHaveLength(10)
  })

  it('404 for a missing question (not 200 + empty)', async () => {
    expect((await scoresGet(REQ, ctx(MISSING_ID))).status).toBe(404)
  })
})

describe('POST /api/admin/questions/[id]/promote', () => {
  it('200: promotes and returns the canonical question', async () => {
    const id = await insert('Well defined?', 'clustered')
    const res = await promotePost(REQ, ctx(id))
    expect(res.status).toBe(200)
    const { question: updated } = await res.json()
    expect(updated.state).toBe('canonical')
  })

  it('404 for a missing question', async () => {
    expect((await promotePost(REQ, ctx(MISSING_ID))).status).toBe(404)
  })

  it('409 for a re-promote', async () => {
    const id = await insert('once', 'clustered')
    await promotePost(REQ, ctx(id))
    expect((await promotePost(REQ, ctx(id))).status).toBe(409)
  })
})
