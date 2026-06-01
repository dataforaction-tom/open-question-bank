import { db } from '@/db/client'
import { question, type Question } from '@/db/schema'
import { embedForActiveVersion } from '@/lib/embedding'
import { findNearest, type DedupCandidate } from '@/lib/dedup'

export interface SubmitInput {
  rawText: string
  visibility: 'anonymous' | 'public'
  submitterRef?: string | null
}

export interface PrepareResult {
  status: 'created' | 'candidates'
  question?: { id: string; canonicalText: string }
  candidates?: DedupCandidate[]
}

/**
 * Dedup-at-source entry point. Embeds the text, looks for near matches, and either
 * returns candidates ("yours or new?") or — when nothing is close — creates the question.
 */
export async function prepareSubmission(input: SubmitInput): Promise<PrepareResult> {
  const { embedding, embeddingModelVersion, datasetVersionId, dedupThreshold } =
    await embedForActiveVersion(input.rawText)

  const candidates = await findNearest(embedding, datasetVersionId, dedupThreshold)
  if (candidates.length > 0) {
    return { status: 'candidates', candidates }
  }

  const created = await insertQuestion(input, {
    embedding,
    embeddingModelVersion,
    datasetVersionId,
    state: 'submitted',
  })
  return { status: 'created', question: { id: created.id, canonicalText: created.canonicalText } }
}

/**
 * Persist a question after the submitter has decided. With `mergeInto`, store it as a
 * variant of the chosen canonical question; otherwise store it as a fresh submission.
 */
export async function createQuestion(
  input: SubmitInput,
  options: { mergeInto?: string } = {},
): Promise<Question> {
  const { embedding, embeddingModelVersion, datasetVersionId } = await embedForActiveVersion(
    input.rawText,
  )
  return insertQuestion(input, {
    embedding,
    embeddingModelVersion,
    datasetVersionId,
    state: options.mergeInto ? 'merged_as_variant' : 'submitted',
    canonicalOf: options.mergeInto,
  })
}

async function insertQuestion(
  input: SubmitInput,
  fields: {
    embedding: number[]
    embeddingModelVersion: string
    datasetVersionId: number
    state: 'submitted' | 'merged_as_variant'
    canonicalOf?: string
  },
): Promise<Question> {
  const [row] = await db
    .insert(question)
    .values({
      rawText: input.rawText,
      canonicalText: input.rawText, // canonical starts equal to raw; refinements come later
      embedding: fields.embedding,
      embeddingModelVersion: fields.embeddingModelVersion,
      datasetVersionId: fields.datasetVersionId,
      submitterRef: input.submitterRef ?? null,
      visibility: input.visibility,
      state: fields.state,
      canonicalOf: fields.canonicalOf ?? null,
    })
    .returning()
  return row
}
