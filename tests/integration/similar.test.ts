import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { comparison, datasetVersion, question, score } from '@/db/schema'
import { findSimilarQuestions } from '@/lib/similar'
import { NotFoundError } from '@/lib/errors'
import { ensureDefaultWorkspace, DEFAULT_WORKSPACE_ID } from '@/lib/workspace'

let versionId: number
let otherVersionId: number

function pad(vec: number[]): number[] {
  return [...vec, ...Array(768 - vec.length).fill(0)]
}

async function q(
  text: string,
  embedding: number[] | null,
  state: 'submitted' | 'canonical' | 'ranked' = 'canonical',
  datasetVersionId = versionId,
): Promise<string> {
  const [row] = await db
    .insert(question)
    .values({
      rawText: text,
      canonicalText: text,
      embedding: embedding ? pad(embedding) : null,
      embeddingModelVersion: 'test@sha256:test',
      workspaceId: DEFAULT_WORKSPACE_ID,
      datasetVersionId,
      visibility: 'public',
      state,
    })
    .returning()
  return row.id
}

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ${comparison} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${score} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${question} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${datasetVersion} RESTART IDENTITY CASCADE`)
  await ensureDefaultWorkspace()
  const [v] = await db
    .insert(datasetVersion)
    .values({ embeddingModel: 'test', embeddingModelDigest: 'sha256:a', embeddingDim: 768 })
    .returning()
  versionId = v.id
  // A second (inactive) version in the same workspace — its questions must not leak into results.
  const [v2] = await db
    .insert(datasetVersion)
    .values({ embeddingModel: 'test', embeddingModelDigest: 'sha256:b', embeddingDim: 768, isActive: false })
    .returning()
  otherVersionId = v2.id
})
afterAll(async () => {
  await pool.end()
})

describe('findSimilarQuestions', () => {
  it('returns neighbours nearest-first, excluding the source itself', async () => {
    const source = await q('the source', [1, 0, 0])
    const near = await q('the near one', [0.99, 0.01, 0])
    const nearer = await q('the nearer one', [0.995, 0.005, 0])

    const results = await findSimilarQuestions(source)
    expect(results.map((r) => r.id)).toEqual([nearer, near])
    expect(results.map((r) => r.id)).not.toContain(source)
    expect(results[0].distance).toBeLessThan(results[1].distance)
  })

  it('excludes neighbours beyond the dataset version similarity threshold (default 0.42)', async () => {
    const source = await q('the source', [1, 0, 0])
    const near = await q('the near one', [0.95, 0.05, 0]) // cosine distance ≈ 0.0026, within threshold
    const far = await q('the unrelated one', [0, 1, 0]) // orthogonal, cosine distance = 1, beyond threshold

    const results = await findSimilarQuestions(source)
    expect(results.map((r) => r.id)).toEqual([near])
    expect(results.map((r) => r.id)).not.toContain(far)
  })

  it('reuses existing embeddings only — never re-embeds (no model call needed here)', async () => {
    const source = await q('source', [1, 0, 0])
    const near = await q('near', [0.9, 0.1, 0])
    // No embedding service is mocked or available; a result proves we read stored vectors.
    const results = await findSimilarQuestions(source, { limit: 1 })
    expect(results.map((r) => r.id)).toEqual([near])
  })

  it('only returns the requested states (public hides in-flight questions)', async () => {
    const source = await q('source', [1, 0, 0])
    const canonicalNeighbour = await q('canonical neighbour', [0.9, 0.1, 0], 'canonical')
    await q('submitted neighbour', [0.91, 0.09, 0], 'submitted') // closer, but not public

    const results = await findSimilarQuestions(source)
    expect(results.map((r) => r.id)).toEqual([canonicalNeighbour])
  })

  it('is scoped to the source question dataset version', async () => {
    const source = await q('source', [1, 0, 0])
    await q('other-version neighbour', [0.99, 0.01, 0], 'canonical', otherVersionId)

    const results = await findSimilarQuestions(source)
    expect(results).toEqual([]) // the close neighbour is in a different dataset version
  })

  it('returns [] when the source has no embedding', async () => {
    const source = await q('embeddingless', null)
    await q('a neighbour', [0.9, 0.1, 0])
    expect(await findSimilarQuestions(source)).toEqual([])
  })

  it('excludes published neighbours that have no embedding (no false 0-distance match)', async () => {
    const source = await q('source', [1, 0, 0])
    const real = await q('real neighbour', [0.9, 0.1, 0])
    await q('embeddingless canonical', null) // published but no vector — must not appear

    const results = await findSimilarQuestions(source)
    expect(results.map((r) => r.id)).toEqual([real])
    expect(results.every((r) => Number.isFinite(r.distance))).toBe(true)
  })

  it('throws NotFoundError for an unknown id', async () => {
    await expect(
      findSimilarQuestions('00000000-0000-0000-0000-0000000000ff'),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('refuses to pivot on an unpublished source (anonymity guard)', async () => {
    // A submitted question must not be usable as a "find similar" pivot via the public default set.
    const submitted = await q('an unpublished source', [1, 0, 0], 'submitted')
    await q('a public neighbour', [0.9, 0.1, 0], 'canonical')
    await expect(findSimilarQuestions(submitted)).rejects.toBeInstanceOf(NotFoundError)
  })
})
