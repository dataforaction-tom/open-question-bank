import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import {
  campaign,
  campaignQuestion,
  cluster,
  comparison,
  datasetVersion,
  question,
  refinement,
  score,
} from '@/db/schema'
import { getPublicQuestion } from '@/lib/discovery'
import { NotFoundError } from '@/lib/errors'
import { ensureDefaultWorkspace, DEFAULT_WORKSPACE_ID } from '@/lib/workspace'

let versionId: number

function pad(vec: number[]): number[] {
  return [...vec, ...Array(768 - vec.length).fill(0)]
}

async function q(
  text: string,
  state: 'submitted' | 'canonical' | 'ranked' = 'canonical',
): Promise<string> {
  const [row] = await db
    .insert(question)
    .values({
      rawText: text,
      canonicalText: text,
      embedding: pad([1, 0, 0]),
      embeddingModelVersion: 'test@sha256:test',
      workspaceId: DEFAULT_WORKSPACE_ID,
      datasetVersionId: versionId,
      submitterRef: 'secret-token',
      visibility: 'public',
      state,
    })
    .returning()
  return row.id
}

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ${refinement} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${comparison} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${score} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${campaignQuestion} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${campaign} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${cluster} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${question} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${datasetVersion} RESTART IDENTITY CASCADE`)
  await ensureDefaultWorkspace()
  const [v] = await db
    .insert(datasetVersion)
    .values({ embeddingModel: 'test', embeddingModelDigest: 'sha256:test', embeddingDim: 768 })
    .returning()
  versionId = v.id
})
afterAll(async () => {
  await pool.end()
})

describe('getPublicQuestion', () => {
  it('returns an anonymised detail with cluster, campaigns and refinement lineage', async () => {
    const target = await q('the target question', 'ranked')
    const sibling = await q('a cluster sibling', 'canonical')

    // Cluster the two together.
    const [cl] = await db
      .insert(cluster)
      .values({ datasetVersionId: versionId, representativeQuestionId: target, thresholdUsed: 0.2 })
      .returning()
    await db.update(question).set({ clusterId: cl.id }).where(eq(question.id, target))
    await db.update(question).set({ clusterId: cl.id }).where(eq(question.id, sibling))

    // A closed campaign the target belongs to.
    const [c] = await db
      .insert(campaign)
      .values({ prompt: 'closed campaign', comparisonAxis: 'importance', state: 'closed' })
      .returning()
    await db.insert(campaignQuestion).values({ campaignId: c.id, questionId: target })

    // A refinement with criteria — actor must NOT surface.
    await db.insert(refinement).values({
      questionId: target,
      before: 'old',
      after: 'the target question',
      criteriaApplied: ['specific', 'scoped'],
      suggestedBy: 'llm',
      action: 'accept',
      actorRef: 'admin-secret',
    })

    const detail = await getPublicQuestion(target)
    expect(detail.id).toBe(target)
    expect(detail.state).toBe('ranked')
    expect(detail.cluster?.id).toBe(cl.id)
    expect(detail.cluster?.representativeText).toBe('the target question')
    expect(detail.cluster?.size).toBe(2)
    expect(detail.campaigns).toEqual([{ id: c.id, prompt: 'closed campaign', state: 'closed' }])
    expect(detail.refinement.count).toBe(1)
    expect(detail.refinement.criteria.sort()).toEqual(['scoped', 'specific'])
    // Anonymity: nothing in the payload exposes actor or submitter identity.
    expect(JSON.stringify(detail)).not.toContain('admin-secret')
    expect(JSON.stringify(detail)).not.toContain('secret-token')
  })

  it('404s (NotFoundError) for a non-published question', async () => {
    const submitted = await q('still in the queue', 'submitted')
    await expect(getPublicQuestion(submitted)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('returns an empty cluster/campaign/refinement shape when there is nothing extra', async () => {
    const lonely = await q('a lonely canonical question', 'canonical')
    const detail = await getPublicQuestion(lonely)
    expect(detail.cluster).toBeNull()
    expect(detail.campaigns).toEqual([])
    expect(detail.refinement).toEqual({ count: 0, criteria: [] })
  })
})
