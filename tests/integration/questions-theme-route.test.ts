import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { datasetVersion, question } from '@/db/schema'
import { GET } from '@/app/api/questions/route'

let versionId: number

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ${question}, ${datasetVersion} RESTART IDENTITY CASCADE`)
  const [v] = await db
    .insert(datasetVersion)
    .values({ embeddingModel: 'test', embeddingModelDigest: 'sha256:test', embeddingDim: 768, dedupThreshold: 0.15, clusterThreshold: 0.3 })
    .returning()
  versionId = v.id
  await db.insert(question).values([
    { rawText: 'housing q', canonicalText: 'housing q', embedding: [1, ...Array(767).fill(0)], embeddingModelVersion: 't', datasetVersionId: versionId, visibility: 'public', state: 'canonical', theme: 'Housing' },
    { rawText: 'transport q', canonicalText: 'transport q', embedding: [0, 1, ...Array(766).fill(0)], embeddingModelVersion: 't', datasetVersionId: versionId, visibility: 'public', state: 'ranked', theme: 'Transport & Streets' },
  ])
})
afterAll(async () => {
  await pool.end()
})

function req(url: string): Request {
  return new Request(`http://localhost${url}`)
}

describe('GET /api/questions?theme=', () => {
  it('filters to the given theme', async () => {
    const res = await GET(req('/api/questions?theme=Housing'))
    const body = await res.json()
    expect(body.questions.map((q: { canonicalText: string }) => q.canonicalText)).toEqual(['housing q'])
  })

  it('returns all canonical/ranked when no theme is given', async () => {
    const res = await GET(req('/api/questions'))
    const body = await res.json()
    expect(body.questions).toHaveLength(2)
  })

  it('returns [] for an unknown theme', async () => {
    const res = await GET(req('/api/questions?theme=Nonsense'))
    expect((await res.json()).questions).toEqual([])
  })
})
