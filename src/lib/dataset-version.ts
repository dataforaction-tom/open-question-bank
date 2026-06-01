import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { datasetVersion, type DatasetVersion } from '@/db/schema'

export interface DatasetVersionConfig {
  embeddingModel: string
  embeddingModelDigest: string
  embeddingDim: number
  dedupThreshold: number
  clusterThreshold?: number
}

/** Return the single active dataset version, or null if none has been seeded. */
export async function getActiveDatasetVersion(): Promise<DatasetVersion | null> {
  const rows = await db
    .select()
    .from(datasetVersion)
    .where(eq(datasetVersion.isActive, true))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Idempotently ensure an active dataset version exists; return it.
 * Concurrent first calls are guarded by the `one_active_dataset_version` partial unique index:
 * the loser's INSERT raises a unique violation, after which the now-existing row is returned.
 */
export async function ensureActiveDatasetVersion(
  config: DatasetVersionConfig,
): Promise<DatasetVersion> {
  const existing = await getActiveDatasetVersion()
  if (existing) return existing

  try {
    const [created] = await db
      .insert(datasetVersion)
      .values({
        embeddingModel: config.embeddingModel,
        embeddingModelDigest: config.embeddingModelDigest,
        embeddingDim: config.embeddingDim,
        dedupThreshold: config.dedupThreshold,
        clusterThreshold: config.clusterThreshold,
        isActive: true,
      })
      .returning()
    return created
  } catch {
    // Lost a race to another inserter — the active row now exists.
    const active = await getActiveDatasetVersion()
    if (active) return active
    throw new Error('Failed to ensure an active dataset version')
  }
}
