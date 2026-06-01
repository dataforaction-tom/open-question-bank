import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { ensureActiveDatasetVersion, getActiveDatasetVersion } from '@/lib/dataset-version'
import { datasetVersion } from '@/db/schema'

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ${datasetVersion} RESTART IDENTITY CASCADE`)
})
afterAll(async () => {
  await pool.end()
})

describe('dataset version', () => {
  it('seeds an active version when none exists, then returns it', async () => {
    const created = await ensureActiveDatasetVersion({
      embeddingModel: 'nomic-embed-text',
      embeddingModelDigest: 'sha256:abc',
      embeddingDim: 768,
      dedupThreshold: 0.15,
    })
    expect(created.isActive).toBe(true)
    expect(created.embeddingDim).toBe(768)

    const active = await getActiveDatasetVersion()
    expect(active?.id).toBe(created.id)
  })

  it('does not create a second version if an active one already exists', async () => {
    const cfg = {
      embeddingModel: 'nomic-embed-text',
      embeddingModelDigest: 'sha256:abc',
      embeddingDim: 768,
      dedupThreshold: 0.15,
    }
    const first = await ensureActiveDatasetVersion(cfg)
    const second = await ensureActiveDatasetVersion(cfg)
    expect(second.id).toBe(first.id)
  })
})
