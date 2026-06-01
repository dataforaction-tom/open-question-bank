import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { cluster, datasetVersion, question } from '@/db/schema'
import { assignToNearestCluster } from '@/lib/clustering'

let versionId: number

function pad(vec: number[]): number[] {
  return [...vec, ...Array(768 - vec.length).fill(0)]
}

async function insertQuestion(text: string, vec: number[], dvId = versionId): Promise<string> {
  const [row] = await db
    .insert(question)
    .values({
      rawText: text,
      canonicalText: text,
      embedding: pad(vec),
      embeddingModelVersion: 'test@sha256:test',
      datasetVersionId: dvId,
      visibility: 'public',
    })
    .returning()
  return row.id
}

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ${cluster} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${question} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${datasetVersion} RESTART IDENTITY CASCADE`)
  const [v] = await db
    .insert(datasetVersion)
    .values({
      embeddingModel: 'test',
      embeddingModelDigest: 'sha256:test',
      embeddingDim: 768,
      dedupThreshold: 0.15,
      clusterThreshold: 0.3,
    })
    .returning()
  versionId = v.id
})
afterAll(async () => {
  await pool.end()
})

describe('assignToNearestCluster', () => {
  it('forms a new cluster for the first question', async () => {
    const q1 = await insertQuestion('first', [1, 0, 0])
    const result = await assignToNearestCluster(q1)
    expect(result.created).toBe(true)

    const clusters = await db.select().from(cluster)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].representativeQuestionId).toBe(q1)
    const [stored] = await db.select().from(question).where(eq(question.id, q1))
    expect(stored.clusterId).toBe(result.clusterId)
  })

  it('joins a near question to the existing cluster', async () => {
    const q1 = await insertQuestion('first', [1, 0, 0])
    const r1 = await assignToNearestCluster(q1)
    const q2 = await insertQuestion('near', [0.9, 0.1, 0]) // cosine distance ~0.006 < 0.3
    const r2 = await assignToNearestCluster(q2)

    expect(r2.created).toBe(false)
    expect(r2.clusterId).toBe(r1.clusterId)
    expect(await db.select().from(cluster)).toHaveLength(1)
  })

  it('forms a new cluster for a far question', async () => {
    const q1 = await insertQuestion('first', [1, 0, 0])
    await assignToNearestCluster(q1)
    const q2 = await insertQuestion('far', [0, 1, 0]) // distance 1.0 > 0.3
    const r2 = await assignToNearestCluster(q2)

    expect(r2.created).toBe(true)
    expect(await db.select().from(cluster)).toHaveLength(2)
  })

  it('never joins a cluster from a different dataset version', async () => {
    const [other] = await db
      .insert(datasetVersion)
      .values({
        embeddingModel: 'test',
        embeddingModelDigest: 'sha256:test',
        embeddingDim: 768,
        dedupThreshold: 0.15,
        clusterThreshold: 0.3,
        isActive: false,
      })
      .returning()
    const otherQ = await insertQuestion('other-version', [1, 0, 0], other.id)
    await assignToNearestCluster(otherQ)

    const q1 = await insertQuestion('active-version', [1, 0, 0])
    const r1 = await assignToNearestCluster(q1)
    expect(r1.created).toBe(true)

    const [stored] = await db.select().from(cluster).where(eq(cluster.id, r1.clusterId))
    expect(stored.datasetVersionId).toBe(versionId)
  })
})
