import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { datasetVersion, question, refinement, workspace } from '@/db/schema'
import type { ReasoningProvider, RefinementSuggestion } from '@/lib/llm'
import {
  IneligibleError,
  listClustered,
  NotFoundError,
  recordRefinement,
  suggestRefinement,
} from '@/lib/refinement'
import { resetWorkspaceCache, DEFAULT_WORKSPACE_ID } from '@/lib/workspace'

let versionId: number

function pad(vec: number[]): number[] {
  return [...vec, ...Array(768 - vec.length).fill(0)]
}

async function insert(text: string, state: 'submitted' | 'clustered'): Promise<string> {
  const [row] = await db
    .insert(question)
    .values({
      rawText: text,
      canonicalText: text,
      embedding: pad([1, 0, 0]),
      embeddingModelVersion: 'test@sha256:test',
      datasetVersionId: versionId,
      visibility: 'public',
      state,
    })
    .returning()
  return row.id
}

const SUGGESTION: RefinementSuggestion = {
  suggestedText: 'refined text',
  critique: [{ criterion: 'specific', verdict: 'fail', note: 'too vague' }],
  criteriaApplied: ['specific'],
  rationale: 'made it concrete',
  model: 'qwen2.5:7b',
  modelVersion: 'sha256:abc',
}
const stubProvider: Pick<ReasoningProvider, 'refine'> = { refine: async () => SUGGESTION }

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ${refinement} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${question} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${datasetVersion} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${workspace} RESTART IDENTITY CASCADE`)
  await db.insert(workspace).values({ id: DEFAULT_WORKSPACE_ID, slug: 'default', name: 'Default' })
  const [v] = await db
    .insert(datasetVersion)
    .values({
      embeddingModel: 'test',
      embeddingModelDigest: 'sha256:test',
      embeddingDim: 768,
    })
    .returning()
  versionId = v.id
})
afterAll(async () => {
  await pool.end()
})

describe('listClustered', () => {
  it('returns only clustered questions, oldest first', async () => {
    await insert('submitted one', 'submitted')
    await insert('clustered one', 'clustered')
    const rows = await listClustered()
    expect(rows.map((r) => r.canonicalText)).toEqual(['clustered one'])
  })
})

describe('suggestRefinement', () => {
  it('returns the before text and a suggestion for a clustered question', async () => {
    const id = await insert('How do we fix education?', 'clustered')
    const { before, suggestion } = await suggestRefinement(id, stubProvider)
    expect(before).toBe('How do we fix education?')
    expect(suggestion.suggestedText).toBe('refined text')
  })

  it('throws IneligibleError for a non-clustered question', async () => {
    const id = await insert('pending', 'submitted')
    await expect(suggestRefinement(id, stubProvider)).rejects.toBeInstanceOf(IneligibleError)
  })

  it('throws NotFoundError for a missing question', async () => {
    await expect(
      suggestRefinement('00000000-0000-0000-0000-000000000000', stubProvider),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('recordRefinement', () => {
  const base = {
    before: 'How do we fix education?',
    llmSuggestedText: 'refined text',
    criteriaApplied: ['specific'],
    critique: SUGGESTION.critique,
    rationale: 'made it concrete',
    model: 'qwen2.5:7b',
    modelVersion: 'sha256:abc',
    actorRef: 'admin',
  }

  it('accept: writes a row and updates canonical_text', async () => {
    const id = await insert('How do we fix education?', 'clustered')
    const row = await recordRefinement({ ...base, questionId: id, action: 'accept', finalText: 'refined text' })
    expect(row.after).toBe('refined text')
    expect(row.llmSuggestedText).toBe('refined text')
    const [q] = await db.select().from(question).where(eq(question.id, id))
    expect(q.canonicalText).toBe('refined text')
    expect(q.state).toBe('clustered') // unchanged
    expect(q.embedding).toEqual(pad([1, 0, 0])) // pinned embedding must never change on refinement
  })

  it('edit: preserves both the proposal and the human-final text', async () => {
    const id = await insert('How do we fix education?', 'clustered')
    const row = await recordRefinement({
      ...base,
      questionId: id,
      action: 'edit',
      finalText: 'human-corrected text',
    })
    expect(row.llmSuggestedText).toBe('refined text')
    expect(row.after).toBe('human-corrected text')
    const [q] = await db.select().from(question).where(eq(question.id, id))
    expect(q.canonicalText).toBe('human-corrected text')
    expect(q.embedding).toEqual(pad([1, 0, 0])) // pinned embedding must never change on refinement
  })

  it('reject: writes a row with null after and leaves canonical_text unchanged', async () => {
    const id = await insert('How do we fix education?', 'clustered')
    const row = await recordRefinement({ ...base, questionId: id, action: 'reject', finalText: null })
    expect(row.after).toBeNull()
    const [q] = await db.select().from(question).where(eq(question.id, id))
    expect(q.canonicalText).toBe('How do we fix education?')
  })

  it('rejects recording against a non-clustered question', async () => {
    const id = await insert('pending', 'submitted')
    await expect(
      recordRefinement({ ...base, questionId: id, action: 'accept', finalText: 'x' }),
    ).rejects.toBeInstanceOf(IneligibleError)
  })

  it('throws NotFoundError for a missing question', async () => {
    await expect(
      recordRefinement({
        ...base,
        questionId: '00000000-0000-0000-0000-000000000000',
        action: 'accept',
        finalText: 'x',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('refinement — workspace scoping', () => {
  const OTHER_WS = '00000000-0000-0000-0000-000000000002'

  afterEach(() => resetWorkspaceCache())

  it('listClustered only returns questions from the active workspace', async () => {
    await db.insert(workspace).values({ id: OTHER_WS, slug: 'other', name: 'Other' })
    const [v2] = await db
      .insert(datasetVersion)
      .values({
        workspaceId: OTHER_WS,
        embeddingModel: 'test',
        embeddingModelDigest: 'sha256:other',
        embeddingDim: 768,
      })
      .returning()
    await db.insert(question).values({
      rawText: 'foreign clustered',
      canonicalText: 'foreign clustered',
      embedding: pad([1, 0, 0]),
      embeddingModelVersion: 'test@sha256:other',
      workspaceId: OTHER_WS,
      datasetVersionId: v2.id,
      visibility: 'anonymous',
      state: 'clustered',
    })

    const rows = await listClustered()
    expect(rows.find((r) => r.canonicalText === 'foreign clustered')).toBeUndefined()
  })

  it('suggestRefinement throws NotFoundError for a question in another workspace', async () => {
    await db.insert(workspace).values({ id: OTHER_WS, slug: 'other', name: 'Other' })
    const [v2] = await db
      .insert(datasetVersion)
      .values({
        workspaceId: OTHER_WS,
        embeddingModel: 'test',
        embeddingModelDigest: 'sha256:other',
        embeddingDim: 768,
      })
      .returning()
    const [foreign] = await db.insert(question).values({
      rawText: 'foreign clustered',
      canonicalText: 'foreign clustered',
      embedding: pad([1, 0, 0]),
      embeddingModelVersion: 'test@sha256:other',
      workspaceId: OTHER_WS,
      datasetVersionId: v2.id,
      visibility: 'anonymous',
      state: 'clustered',
    }).returning()

    await expect(suggestRefinement(foreign.id, stubProvider)).rejects.toBeInstanceOf(NotFoundError)
  })
})
