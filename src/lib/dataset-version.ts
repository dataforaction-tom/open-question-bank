import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { datasetVersion, type DatasetVersion } from '@/db/schema'
import { getActiveWorkspaceId } from '@/lib/workspace'

export interface DatasetVersionConfig {
  embeddingModel: string
  embeddingModelDigest: string
  embeddingDim: number
  dedupThreshold: number
  clusterThreshold?: number
}

/** Return the active dataset version for the workspace, or null if none has been seeded. */
export async function getActiveDatasetVersion(
  workspaceId?: string,
): Promise<DatasetVersion | null> {
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  const rows = await db
    .select()
    .from(datasetVersion)
    .where(and(eq(datasetVersion.isActive, true), eq(datasetVersion.workspaceId, ws)))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Idempotently ensure an active dataset version exists for the workspace; return it.
 * Concurrent first calls are guarded by the `one_active_dataset_version_per_workspace` partial
 * unique index: the loser's INSERT raises a unique violation, after which the row is returned.
 */
export async function ensureActiveDatasetVersion(
  config: DatasetVersionConfig,
  workspaceId?: string,
): Promise<DatasetVersion> {
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  const existing = await getActiveDatasetVersion(ws)
  if (existing) return existing

  try {
    const [created] = await db
      .insert(datasetVersion)
      .values({
        workspaceId: ws,
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
    const active = await getActiveDatasetVersion(ws)
    if (active) return active
    throw new Error('Failed to ensure an active dataset version')
  }
}
