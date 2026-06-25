import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { campaign, campaignQuestion, cluster, comparison, datasetVersion, question, score, synthesis } from '@/db/schema'
import { GET } from '@/app/api/browse/route'
import { THEMES } from '@/lib/themes'

let versionId: number

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE
    ${synthesis}, ${score}, ${comparison}, ${campaignQuestion}, ${campaign},
    ${cluster}, ${question}, ${datasetVersion} RESTART IDENTITY CASCADE`)
  const [v] = await db
    .insert(datasetVersion)
    .values({ embeddingModel: 'test', embeddingModelDigest: 'sha256:test', embeddingDim: 768, dedupThreshold: 0.15, clusterThreshold: 0.3 })
    .returning()
  versionId = v.id
  await db.insert(question).values({
    rawText: 'a canonical q', canonicalText: 'a canonical q',
    embedding: [1, ...Array(767).fill(0)], embeddingModelVersion: 'test@sha256:test',
    datasetVersionId: versionId, visibility: 'public', state: 'canonical', theme: 'Housing',
  })
})
afterAll(async () => {
  await pool.end()
})

describe('GET /api/browse', () => {
  it('returns the four-rail shape with no leakage', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(['mostAsked', 'recent', 'themes', 'topOfCampaigns'])
    expect(body.recent[0].canonicalText).toBe('a canonical q')
    expect(body.recent[0]).not.toHaveProperty('submitterRef')
    expect(body.recent[0]).not.toHaveProperty('embedding')
    expect(body.themes).toHaveLength(THEMES.length) // no Unsorted bucket here
  })
})
