import { embed } from '@/lib/ollama'
import { getActiveDatasetVersion } from '@/lib/dataset-version'

export interface EmbeddingResult {
  embedding: number[]
  /** Provenance: "<model>@<digest>" of the pinned model that produced this vector. */
  embeddingModelVersion: string
  workspaceId: string
  datasetVersionId: number
  dedupThreshold: number
}

/**
 * Embed text using the workspace's active pinned model, returning the vector plus provenance.
 * The workspace is taken from the resolved dataset version (a version belongs to one workspace),
 * so callers never need a separate workspace lookup.
 */
export async function embedForActiveVersion(
  text: string,
  workspaceId?: string,
): Promise<EmbeddingResult> {
  const version = await getActiveDatasetVersion(workspaceId)
  if (!version) {
    throw new Error('No active dataset version. Seed one before embedding.')
  }
  const embedding = await embed(text, version.embeddingModel)
  return {
    embedding,
    embeddingModelVersion: `${version.embeddingModel}@${version.embeddingModelDigest}`,
    workspaceId: version.workspaceId,
    datasetVersionId: version.id,
    dedupThreshold: version.dedupThreshold,
  }
}
