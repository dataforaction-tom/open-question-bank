import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { cluster, datasetVersion, moderationEvent, question } from '@/db/schema'
import { approveQuestion, listPending, rejectQuestion } from '@/lib/moderation'
import { MockProvider } from '@/lib/llm'

let versionId: number

function pad(vec: number[]): number[] {
  return [...vec, ...Array(768 - vec.length).fill(0)]
}

async function insertSubmitted(text: string, vec: number[]): Promise<string> {
  const [row] = await db
    .insert(question)
    .values({
      rawText: text,
      canonicalText: text,
      embedding: pad(vec),
      embeddingModelVersion: 'test@sha256:test',
      datasetVersionId: versionId,
      visibility: 'public',
      state: 'submitted',
    })
    .returning()
  return row.id
}

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ${moderationEvent} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${cluster} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${question} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${datasetVersion} RESTART IDENTITY CASCADE`)
  const [v] = await db
    .insert(datasetVersion)
    .values({
      embeddingModel: 'test',
      embeddingModelDigest: 'sha256:test',
      embeddingDim: 768,
      dedupThreshold: 0.15,
      clusterThreshold: 0.3,
    })
    .returning()
  versionId = v.id
  vi.stubEnv('REASONING_PROVIDER', 'mock')
})
afterAll(async () => {
  await pool.end()
})

describe('listPending', () => {
  it('returns only submitted questions, oldest first', async () => {
    await insertSubmitted('a', [1, 0, 0])
    await insertSubmitted('b', [0, 1, 0])
    const pending = await listPending()
    expect(pending.map((p) => p.canonicalText)).toEqual(['a', 'b'])
  })
})

describe('approveQuestion', () => {
  it('clusters the question, logs an event, and sets state=clustered', async () => {
    const id = await insertSubmitted('q', [1, 0, 0])
    const result = await approveQuestion(id, 'admin')
    expect(result.created).toBe(true)

    const [q] = await db.select().from(question).where(eq(question.id, id))
    expect(q.state).toBe('clustered')
    expect(q.clusterId).toBe(result.clusterId)

    const events = await db.select().from(moderationEvent).where(eq(moderationEvent.questionId, id))
    expect(events).toHaveLength(1)
    expect(events[0].action).toBe('approve')
    expect(events[0].actorRef).toBe('admin')
  })

  it('refuses to approve a question that is not submitted', async () => {
    const id = await insertSubmitted('q', [1, 0, 0])
    await approveQuestion(id, 'admin')
    await expect(approveQuestion(id, 'admin')).rejects.toThrow(/not pending/)
    const events = await db.select().from(moderationEvent).where(eq(moderationEvent.questionId, id))
    expect(events).toHaveLength(1)
  })

  it('auto-classifies the question theme on approval', async () => {
    const id = await insertSubmitted('How can we add protected cycle lanes on busy roads?', [1, 0, 0])
    await approveQuestion(id, 'admin', new MockProvider())
    const [row] = await db.select().from(question).where(eq(question.id, id)).limit(1)
    expect(row.state).toBe('clustered')
    expect(row.theme).toBe('Transport & Streets')
  })

  it('still approves when classification fails (advisory)', async () => {
    const id = await insertSubmitted('A neutral question with no theme keyword', [0, 1, 0])
    const failing = {
      ...new MockProvider(),
      classify: async () => {
        throw new Error('provider down')
      },
    }
    await approveQuestion(id, 'admin', failing)
    const [row] = await db.select().from(question).where(eq(question.id, id)).limit(1)
    expect(row.state).toBe('clustered')
    expect(row.theme).toBeNull()
  })

  it('rolls back the approval (event + state) when the question has no embedding', async () => {
    const [row] = await db
      .insert(question)
      .values({
        rawText: 'no-embedding',
        canonicalText: 'no-embedding',
        embedding: null,
        embeddingModelVersion: 'test@sha256:test',
        datasetVersionId: versionId,
        visibility: 'public',
        state: 'submitted',
      })
      .returning()

    await expect(approveQuestion(row.id, 'admin')).rejects.toThrow(/no embedding/)

    const [q] = await db.select().from(question).where(eq(question.id, row.id))
    expect(q.state).toBe('submitted') // rolled back, not 'clustered'
    const events = await db.select().from(moderationEvent).where(eq(moderationEvent.questionId, row.id))
    expect(events).toHaveLength(0) // event insert rolled back too
  })
})

describe('rejectQuestion', () => {
  it('sets state=rejected and logs an event with the reason', async () => {
    const id = await insertSubmitted('spam', [1, 0, 0])
    await rejectQuestion(id, 'admin', 'off-topic')

    const [q] = await db.select().from(question).where(eq(question.id, id))
    expect(q.state).toBe('rejected')
    expect(q.clusterId).toBeNull()

    const events = await db.select().from(moderationEvent).where(eq(moderationEvent.questionId, id))
    expect(events).toHaveLength(1)
    expect(events[0].action).toBe('reject')
    expect(events[0].reason).toBe('off-topic')
  })

  it('refuses to reject a non-submitted question', async () => {
    const id = await insertSubmitted('q', [1, 0, 0])
    await rejectQuestion(id, 'admin')
    await expect(rejectQuestion(id, 'admin')).rejects.toThrow(/not pending/)
  })
})
