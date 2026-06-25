import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { campaign, campaignQuestion, comparison, datasetVersion, question, score } from '@/db/schema'
import { GET as publicSearch } from '@/app/api/questions/search/route'
import { GET as adminSearch } from '@/app/api/admin/questions/search/route'
import { GET as questionDetail } from '@/app/api/questions/[id]/route'
import { GET as questionSimilar } from '@/app/api/questions/[id]/similar/route'
import { ensureDefaultWorkspace, DEFAULT_WORKSPACE_ID } from '@/lib/workspace'

let versionId: number

function pad(vec: number[]): number[] {
  return [...vec, ...Array(768 - vec.length).fill(0)]
}
async function q(
  text: string,
  state: 'submitted' | 'canonical' | 'ranked',
  embedding: number[] = [1, 0, 0],
): Promise<string> {
  const [row] = await db
    .insert(question)
    .values({
      rawText: text,
      canonicalText: text,
      embedding: pad(embedding),
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
const req = (url: string) => new Request(url)
const withParams = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ${comparison} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${campaignQuestion} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${score} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${campaign} RESTART IDENTITY CASCADE`)
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

describe('GET /api/questions/search (public)', () => {
  it('returns only published states and never the submitter ref', async () => {
    const canon = await q('resilience canonical', 'canonical')
    await q('resilience submitted', 'submitted')

    const res = await publicSearch(req('http://localhost/api/questions/search?q=resilience'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results.map((r: { id: string }) => r.id)).toEqual([canon])
    expect(JSON.stringify(body)).not.toContain('secret-token')
  })

  it('400s on a malformed filter id', async () => {
    const res = await publicSearch(req('http://localhost/api/questions/search?q=x&cluster=not-a-uuid'))
    expect(res.status).toBe(400)
  })

  it('404s when filtering by a hidden (non-public) campaign — no membership leak', async () => {
    const member = await q('resilience hidden member', 'canonical')
    // A draft campaign (hidden from public surfaces) that nonetheless has a canonical member.
    const [c] = await db
      .insert(campaign)
      .values({ prompt: 'secret draft', comparisonAxis: 'importance' })
      .returning()
    await db.insert(campaignQuestion).values({ campaignId: c.id, questionId: member })

    const res = await publicSearch(
      req(`http://localhost/api/questions/search?q=resilience&campaign=${c.id}`),
    )
    expect(res.status).toBe(404)
  })
})

describe('GET /api/admin/questions/search', () => {
  it('spans the whole lifecycle, including unpublished states', async () => {
    await q('resilience canonical', 'canonical')
    await q('resilience submitted', 'submitted')

    const res = await adminSearch(req('http://localhost/api/admin/questions/search?q=resilience'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results).toHaveLength(2)
  })

  it('honours an explicit state filter', async () => {
    await q('resilience canonical', 'canonical')
    const submitted = await q('resilience submitted', 'submitted')
    const res = await adminSearch(
      req('http://localhost/api/admin/questions/search?q=resilience&state=submitted'),
    )
    const body = await res.json()
    expect(body.results.map((r: { id: string }) => r.id)).toEqual([submitted])
  })
})

describe('GET /api/questions/:id (public detail)', () => {
  it('200 for a published question, 404 for an unpublished one', async () => {
    const ranked = await q('a ranked question', 'ranked')
    const submitted = await q('a submitted question', 'submitted')

    const ok = await questionDetail(req(`http://localhost/api/questions/${ranked}`), withParams(ranked))
    expect(ok.status).toBe(200)
    expect((await ok.json()).id).toBe(ranked)

    const notFound = await questionDetail(
      req(`http://localhost/api/questions/${submitted}`),
      withParams(submitted),
    )
    expect(notFound.status).toBe(404)
  })
})

describe('GET /api/questions/:id/similar (public)', () => {
  it('returns nearest published neighbours', async () => {
    const source = await q('source question', 'canonical', [1, 0, 0])
    const near = await q('near question', 'canonical', [0.9, 0.1, 0])

    const res = await questionSimilar(
      req(`http://localhost/api/questions/${source}/similar`),
      withParams(source),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.similar.map((s: { id: string }) => s.id)).toEqual([near])
  })
})
