import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { datasetVersion, definednessScore, moderationEvent, question, workspace } from '@/db/schema'
import type { ReasoningProvider, ScoreResult } from '@/lib/llm'
import { ProviderError } from '@/lib/llm'
import { IneligibleError, NotFoundError } from '@/lib/errors'
import { currentScores, listScores, promoteToCanonical, scoreQuestion } from '@/lib/curation'
import { resetWorkspaceCache, DEFAULT_WORKSPACE_ID } from '@/lib/workspace'

let versionId: number

function pad(vec: number[]): number[] {
  return [...vec, ...Array(768 - vec.length).fill(0)]
}

async function insert(text: string, state: 'submitted' | 'clustered' | 'canonical'): Promise<string> {
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

function stubResult(score: number, modelVersion = 'sha256:abc'): ScoreResult {
  return {
    scores: (['specific', 'answerable', 'scoped', 'non-leading', 'single-barrelled'] as const).map(
      (criterion) => ({ criterion, score, rationale: `because ${criterion}` }),
    ),
    model: 'qwen2.5:7b',
    modelVersion,
  }
}

function stubProvider(score: number, modelVersion?: string): Pick<ReasoningProvider, 'score'> {
  return { score: async () => stubResult(score, modelVersion) }
}

const failingProvider: Pick<ReasoningProvider, 'score'> = {
  score: async () => {
    throw new ProviderError('model unavailable')
  },
}

const MISSING_ID = '00000000-0000-0000-0000-000000000000'

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ${definednessScore} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${moderationEvent} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${question} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${datasetVersion} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${workspace} RESTART IDENTITY CASCADE`)
  await db.insert(workspace).values({ id: DEFAULT_WORKSPACE_ID, slug: 'default', name: 'Default' })
  const [v] = await db
    .insert(datasetVersion)
    .values({ embeddingModel: 'test', embeddingModelDigest: 'sha256:test', embeddingDim: 768 })
    .returning()
  versionId = v.id
})
afterAll(async () => {
  await pool.end()
})

describe('scoreQuestion', () => {
  it('persists five rows with shared timestamp and provenance', async () => {
    const id = await insert('How do we fix education?', 'clustered')
    const rows = await scoreQuestion(id, stubProvider(4))
    expect(rows).toHaveLength(5)
    expect(new Set(rows.map((r) => r.criterion)).size).toBe(5)
    expect(new Set(rows.map((r) => r.timestamp.getTime())).size).toBe(1) // one run, one timestamp
    expect(rows.every((r) => r.model === 'qwen2.5:7b' && r.modelVersion === 'sha256:abc')).toBe(true)
  })

  it('does not change question state (advisory)', async () => {
    const id = await insert('How do we fix education?', 'clustered')
    await scoreQuestion(id, stubProvider(4))
    const [q] = await db.select().from(question).where(eq(question.id, id))
    expect(q.state).toBe('clustered')
  })

  it('throws IneligibleError for a non-clustered question', async () => {
    const id = await insert('pending', 'submitted')
    await expect(scoreQuestion(id, stubProvider(4))).rejects.toBeInstanceOf(IneligibleError)
  })

  it('throws NotFoundError for a missing question', async () => {
    await expect(scoreQuestion(MISSING_ID, stubProvider(4))).rejects.toBeInstanceOf(NotFoundError)
  })

  it('writes nothing when the provider fails', async () => {
    const id = await insert('How do we fix education?', 'clustered')
    await expect(scoreQuestion(id, failingProvider)).rejects.toBeInstanceOf(ProviderError)
    const rows = await db.select().from(definednessScore)
    expect(rows).toHaveLength(0)
  })
})

describe('listScores + currentScores', () => {
  it('throws NotFoundError for a missing question (stricter than listRefinements)', async () => {
    await expect(listScores(MISSING_ID)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('returns [] for a question never scored', async () => {
    const id = await insert('unscored', 'clustered')
    expect(await listScores(id)).toEqual([])
  })

  it('current view is the latest row per criterion after a re-score', async () => {
    const id = await insert('How do we fix education?', 'clustered')
    await scoreQuestion(id, stubProvider(2, 'sha256:old'))
    await scoreQuestion(id, stubProvider(5, 'sha256:new'))
    const history = await listScores(id)
    expect(history).toHaveLength(10) // append-only: both runs kept
    const current = currentScores(history)
    expect(current).toHaveLength(5)
    expect(current.every((r) => r.score === 5 && r.modelVersion === 'sha256:new')).toBe(true)
  })
})

describe('promoteToCanonical', () => {
  it('flips state and appends a promote audit row in one transaction', async () => {
    const id = await insert('Well defined question?', 'clustered')
    const updated = await promoteToCanonical(id, 'admin')
    expect(updated.state).toBe('canonical')
    const events = await db.select().from(moderationEvent).where(eq(moderationEvent.questionId, id))
    expect(events).toHaveLength(1)
    expect(events[0].action).toBe('promote')
    expect(events[0].actorRef).toBe('admin')
  })

  it('works with zero scores on record (scoring is advisory, never a gate)', async () => {
    const id = await insert('never scored', 'clustered')
    const updated = await promoteToCanonical(id, 'admin')
    expect(updated.state).toBe('canonical')
  })

  it('rejects a second promote (no double audit rows)', async () => {
    const id = await insert('once only', 'clustered')
    await promoteToCanonical(id, 'admin')
    await expect(promoteToCanonical(id, 'admin')).rejects.toBeInstanceOf(IneligibleError)
    const events = await db.select().from(moderationEvent).where(eq(moderationEvent.questionId, id))
    expect(events).toHaveLength(1)
  })

  it('throws NotFoundError for a missing question', async () => {
    await expect(promoteToCanonical(MISSING_ID, 'admin')).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('curation — workspace scoping', () => {
  const OTHER_WS = '00000000-0000-0000-0000-000000000002'

  afterEach(() => resetWorkspaceCache())

  it('listScores throws NotFoundError for a question in another workspace', async () => {
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

    await expect(listScores(foreign.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('promoteToCanonical throws NotFoundError for a question in another workspace', async () => {
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
      rawText: 'foreign promote target',
      canonicalText: 'foreign promote target',
      embedding: pad([1, 0, 0]),
      embeddingModelVersion: 'test@sha256:other',
      workspaceId: OTHER_WS,
      datasetVersionId: v2.id,
      visibility: 'anonymous',
      state: 'clustered',
    }).returning()

    await expect(promoteToCanonical(foreign.id, 'admin')).rejects.toBeInstanceOf(NotFoundError)
  })
})
