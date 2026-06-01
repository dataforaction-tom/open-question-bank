import { embed } from '@/lib/ollama'
import { getActiveDatasetVersion } from '@/lib/dataset-version'

export interface EmbeddingResult {
  embedding: number[]
  /** Provenance: "<model>@<digest>" of the pinned model that produced this vector. */
  embeddingModelVersion: string
  datasetVersionId: number
  dedupThreshold: number
}

/** Embed text using the active pinned model, returning the vector plus provenance. */
export async function embedForActiveVersion(text: string): Promise<EmbeddingResult> {
  const version = await getActiveDatasetVersion()
  if (!version) {
    throw new Error('No active dataset version. Seed one before embedding.')
  }
  const embedding = await embed(text, version.embeddingModel)
  return {
    embedding,
    embeddingModelVersion: `${version.embeddingModel}@${version.embeddingModelDigest}`,
    datasetVersionId: version.id,
    dedupThreshold: version.dedupThreshold,
  }
}
