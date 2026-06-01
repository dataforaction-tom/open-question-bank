import 'dotenv/config'
import { ensureActiveDatasetVersion } from '@/lib/dataset-version'
import { getModelDigest } from '@/lib/ollama'
import { pool } from '@/db/client'

async function main() {
  const model = process.env.EMBEDDING_MODEL ?? 'nomic-embed-text'
  const dim = Number(process.env.EMBEDDING_DIM ?? '768')
  const threshold = Number(process.env.DEDUP_THRESHOLD ?? '0.15')
  const clusterThreshold = Number(process.env.CLUSTER_THRESHOLD ?? '0.2')

  if (dim !== 768) {
    throw new Error(`EMBEDDING_DIM=${dim} but the schema column is vector(768). Change the schema (and re-migrate) before changing the dimension.`)
  }

  const digest = await getModelDigest(model)
  const version = await ensureActiveDatasetVersion({
    embeddingModel: model,
    embeddingModelDigest: digest,
    embeddingDim: dim,
    dedupThreshold: threshold,
    clusterThreshold,
  })
  console.log(
    `Active dataset version: id=${version.id} model=${version.embeddingModel} dim=${version.embeddingDim}`,
  )
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
