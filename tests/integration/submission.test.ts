import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql, eq } from 'drizzle-orm'

// Embed deterministically without Ollama: map known phrases to fixed padded vectors.
vi.mock('@/lib/ollama', () => ({
  embed: vi.fn(async (text: string) => {
    const base = text.includes('resilience') ? [1, 0, 0] : [0, 1, 0]
    return [...base, ...Array(768 - base.length).fill(0)]
  }),
}))

import { db, pool } from '@/db/client'
import { datasetVersion, question } from '@/db/schema'
import { ensureActiveDatasetVersion } from '@/lib/dataset-version'
import { prepareSubmission, createQuestion } from '@/lib/submission'

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ${question} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${datasetVersion} RESTART IDENTITY CASCADE`)
  await ensureActiveDatasetVersion({
    embeddingModel: 'nomic-embed-text',
    embeddingModelDigest: 'sha256:abc',
    embeddingDim: 768,
    dedupThreshold: 0.15,
  })
})
afterAll(async () => {
  await pool.end()
})

describe('prepareSubmission', () => {
  it('creates a question when no near match exists', async () => {
    const result = await prepareSubmission({ rawText: 'how do we build resilience?', visibility: 'public' })
    expect(result.status).toBe('created')
    expect(result.question?.canonicalText).toBe('how do we build resilience?')

    const rows = await db.select().from(question)
    expect(rows).toHaveLength(1)
    expect(rows[0].state).toBe('submitted')
    expect(rows[0].embeddingModelVersion).toBe('nomic-embed-text@sha256:abc')
  })

  it('returns candidates instead of creating when a near match exists', async () => {
    await prepareSubmission({ rawText: 'how do we build resilience?', visibility: 'public' })
    const result = await prepareSubmission({ rawText: 'resilience: how do we build it?', visibility: 'public' })

    expect(result.status).toBe('candidates')
    expect(result.candidates?.length).toBeGreaterThan(0)
    expect(await db.select().from(question)).toHaveLength(1) // second not auto-inserted
  })

  it('returns embedding provenance when candidates are found (for reuse in the decision call)', async () => {
    await prepareSubmission({ rawText: 'how do we build resilience?', visibility: 'public' })
    const result = await prepareSubmission({ rawText: 'resilience: how do we build it?', visibility: 'public' })

    expect(result.status).toBe('candidates')
    expect(result.embedding).toBeInstanceOf(Array)
    expect(result.embedding).toHaveLength(768)
    expect(result.embeddingModelVersion).toBe('nomic-embed-text@sha256:abc')
    expect(result.workspaceId).toBeDefined()
    expect(result.datasetVersionId).toBeDefined()
  })
})

describe('createQuestion', () => {
  it('force-creates a new question (submitter chose "new")', async () => {
    await prepareSubmission({ rawText: 'how do we build resilience?', visibility: 'public' })
    const created = await createQuestion({ rawText: 'resilience again', visibility: 'anonymous' })
    expect(created.state).toBe('submitted')
    expect(await db.select().from(question)).toHaveLength(2)
  })

  it('creates a variant linked to the chosen canonical question', async () => {
    const first = await prepareSubmission({ rawText: 'how do we build resilience?', visibility: 'public' })
    const canonicalId = first.question!.id

    const variant = await createQuestion(
      { rawText: 'building resilience?', visibility: 'public' },
      { mergeInto: canonicalId },
    )
    expect(variant.state).toBe('merged_as_variant')
    expect(variant.canonicalOf).toBe(canonicalId)

    const stored = await db.select().from(question).where(eq(question.id, variant.id))
    expect(stored[0].canonicalOf).toBe(canonicalId)
  })

  it('accepts a precomputed embedding to avoid re-embedding', async () => {
    // Track embed calls to prove the precomputed path skips ollama.
    const { embed } = await import('@/lib/ollama')
    const embedCalls = vi.mocked(embed).mock.calls.length

    const precomputed = {
      embedding: Array(768).fill(0),
      embeddingModelVersion: 'nomic-embed-text@sha256:abc',
      workspaceId: '00000000-0000-0000-0000-000000000001',
      datasetVersionId: 1,
    }
    await createQuestion(
      { rawText: 'precomputed test', visibility: 'public' },
      { precomputed },
    )

    // embed() should NOT have been called again.
    expect(vi.mocked(embed).mock.calls.length).toBe(embedCalls)
  })
})
