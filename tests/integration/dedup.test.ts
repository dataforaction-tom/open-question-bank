import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { datasetVersion, question } from '@/db/schema'
import { findNearest } from '@/lib/dedup'

let versionId: number

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ${question} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${datasetVersion} RESTART IDENTITY CASCADE`)
  const [v] = await db
    .insert(datasetVersion)
    .values({
      embeddingModel: 'nomic-embed-text',
      embeddingModelDigest: 'sha256:test',
      embeddingDim: 768, // matches the real vector(768) column width
      dedupThreshold: 0.15,
    })
    .returning()
  versionId = v.id
})
afterAll(async () => {
  await pool.end()
})

// Helper: pad a small vector to the 768-dim column with zeros. With only a few rows the planner
// uses a seq scan (HNSW recall is exercised only on larger data); these tests assert the cosine
// arithmetic and the filtering/ordering, not index recall.
function pad(vec: number[]): number[] {
  return [...vec, ...Array(768 - vec.length).fill(0)]
}

describe('findNearest', () => {
  it('returns existing questions within the distance threshold, closest first', async () => {
    await db.insert(question).values([
      {
        rawText: 'near', canonicalText: 'near', embedding: pad([1, 0, 0]),
        embeddingModelVersion: 'nomic-embed-text@sha256:test', datasetVersionId: versionId, visibility: 'public',
      },
      {
        rawText: 'far', canonicalText: 'far', embedding: pad([0, 1, 0]),
        embeddingModelVersion: 'nomic-embed-text@sha256:test', datasetVersionId: versionId, visibility: 'public',
      },
    ])

    // Query identical to "near" → distance 0; "far" is orthogonal → distance 1 (above threshold).
    const candidates = await findNearest(pad([1, 0, 0]), versionId, 0.15, 5)

    expect(candidates).toHaveLength(1)
    expect(candidates[0].canonicalText).toBe('near')
    expect(candidates[0].distance).toBeCloseTo(0, 5)
  })

  it('returns an empty array when nothing is within threshold', async () => {
    await db.insert(question).values({
      rawText: 'far', canonicalText: 'far', embedding: pad([0, 1, 0]),
      embeddingModelVersion: 'nomic-embed-text@sha256:test', datasetVersionId: versionId, visibility: 'public',
    })
    const candidates = await findNearest(pad([1, 0, 0]), versionId, 0.15, 5)
    expect(candidates).toEqual([])
  })

  it('only matches within the given dataset version', async () => {
    const [other] = await db
      .insert(datasetVersion)
      .values({
        embeddingModel: 'nomic-embed-text', embeddingModelDigest: 'sha256:test',
        embeddingDim: 768, dedupThreshold: 0.15, isActive: false,
      })
      .returning()
    await db.insert(question).values({
      rawText: 'near-but-other-version', canonicalText: 'near-but-other-version', embedding: pad([1, 0, 0]),
      embeddingModelVersion: 'nomic-embed-text@sha256:test', datasetVersionId: other.id, visibility: 'public',
    })
    const candidates = await findNearest(pad([1, 0, 0]), versionId, 0.15, 5)
    expect(candidates).toEqual([])
  })

  it('excludes rejected, merged_as_variant, and flagged questions', async () => {
    // Insert one eligible question and three ineligible ones with identical embeddings.
    const base = {
      rawText: 'shared', canonicalText: 'shared', embedding: pad([1, 0, 0]),
      embeddingModelVersion: 'nomic-embed-text@sha256:test', datasetVersionId: versionId, visibility: 'public' as const,
    }
    await db.insert(question).values([
      { ...base, rawText: 'eligible', canonicalText: 'eligible', state: 'canonical' },
      { ...base, rawText: 'rejected', canonicalText: 'rejected', state: 'rejected' },
      { ...base, rawText: 'merged', canonicalText: 'merged', state: 'merged_as_variant' },
      { ...base, rawText: 'flagged', canonicalText: 'flagged', state: 'flagged' },
    ])
    const candidates = await findNearest(pad([1, 0, 0]), versionId, 0.15, 5)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].canonicalText).toBe('eligible')
  })
})
