import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import {
  campaign,
  campaignQuestion,
  cluster,
  comparison,
  datasetVersion,
  definednessScore,
  question,
  refinement,
  score,
  workspace,
} from '@/db/schema'
import {
  clusterSizes,
  comparisonsByDay,
  definednessBands,
  pipelineTotals,
  questionStateCounts,
  refinementsByDay,
  submissionsByDay,
} from '@/lib/analytics'
import { ensureDefaultWorkspace, DEFAULT_WORKSPACE_ID } from '@/lib/workspace'

const OTHER_WS = '00000000-0000-0000-0000-0000000000b7'
let versionId: number
let otherVersionId: number

function pad(vec: number[]): number[] {
  return [...vec, ...Array(768 - vec.length).fill(0)]
}
async function q(
  text: string,
  state: 'submitted' | 'flagged' | 'canonical' | 'ranked' | 'clustered',
  opts: { workspaceId?: string; datasetVersionId?: number; clusterId?: string } = {},
): Promise<string> {
  const [row] = await db
    .insert(question)
    .values({
      rawText: text,
      canonicalText: text,
      embedding: pad([1, 0, 0]),
      embeddingModelVersion: 'test@sha256:test',
      workspaceId: opts.workspaceId ?? DEFAULT_WORKSPACE_ID,
      datasetVersionId: opts.datasetVersionId ?? versionId,
      visibility: 'public',
      state,
      clusterId: opts.clusterId ?? null,
    })
    .returning()
  return row.id
}
async function scoreRun(questionId: string, value: number) {
  const criteria = ['specific', 'answerable', 'scoped', 'non-leading', 'single-barrelled'] as const
  await db.insert(definednessScore).values(
    criteria.map((criterion) => ({ questionId, criterion, score: value, rationale: 't', model: 't', modelVersion: 't' })),
  )
}

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ${definednessScore} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${refinement} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${comparison} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${score} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${campaignQuestion} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${campaign} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${cluster} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${question} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${datasetVersion} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${workspace} RESTART IDENTITY CASCADE`)
  await ensureDefaultWorkspace()
  await db.insert(workspace).values({ id: OTHER_WS, slug: 'other', name: 'Other' })
  const [v] = await db
    .insert(datasetVersion)
    .values({ embeddingModel: 't', embeddingModelDigest: 'sha256:a', embeddingDim: 768 })
    .returning()
  versionId = v.id
  const [v2] = await db
    .insert(datasetVersion)
    .values({ workspaceId: OTHER_WS, embeddingModel: 't', embeddingModelDigest: 'sha256:b', embeddingDim: 768 })
    .returning()
  otherVersionId = v2.id
})
afterAll(async () => {
  await pool.end()
})

describe('analytics — workspace scoping & aggregates', () => {
  it('questionStateCounts counts only the workspace, ordered by lifecycle', async () => {
    await q('s1', 'submitted')
    await q('s2', 'submitted')
    await q('c1', 'canonical')
    await q('foreign', 'submitted', { workspaceId: OTHER_WS, datasetVersionId: otherVersionId })

    const counts = await questionStateCounts(DEFAULT_WORKSPACE_ID)
    const map = Object.fromEntries(counts.map((p) => [p.label, p.value]))
    expect(map.submitted).toBe(2) // foreign workspace's submitted is excluded
    expect(map.canonical).toBe(1)
    // lifecycle order: submitted before canonical
    expect(counts.map((p) => p.label)).toEqual(['submitted', 'canonical'])
  })

  it('submissionsByDay buckets today and excludes other workspaces', async () => {
    await q('a', 'submitted')
    await q('b', 'submitted')
    await q('foreign', 'submitted', { workspaceId: OTHER_WS, datasetVersionId: otherVersionId })
    const rows = await submissionsByDay(30, DEFAULT_WORKSPACE_ID)
    const total = rows.reduce((sum, r) => sum + r.value, 0)
    expect(total).toBe(2)
  })

  it('pipelineTotals summarises the workspace', async () => {
    await q('p1', 'submitted')
    await q('p2', 'flagged')
    await q('p3', 'canonical')
    await q('p4', 'ranked')
    const totals = await pipelineTotals(DEFAULT_WORKSPACE_ID)
    expect(totals.questions).toBe(4)
    expect(totals.pending).toBe(2) // submitted + flagged
    expect(totals.canonical).toBe(1)
    expect(totals.ranked).toBe(1)
  })

  it('clusterSizes ranks clusters by member count, labelled by representative', async () => {
    const rep = await q('representative question', 'canonical')
    const [cl] = await db
      .insert(cluster)
      .values({ datasetVersionId: versionId, representativeQuestionId: rep, thresholdUsed: 0.2 })
      .returning()
    await db.update(question).set({ clusterId: cl.id }).where(eq(question.id, rep))
    await q('member two', 'canonical', { clusterId: cl.id })

    const sizes = await clusterSizes(10, DEFAULT_WORKSPACE_ID)
    expect(sizes[0]).toEqual({ label: 'representative question', value: 2 })
  })

  it('definednessBands buckets by latest-run average', async () => {
    const high = await q('high', 'canonical')
    const low = await q('low', 'canonical')
    await scoreRun(high, 5)
    await scoreRun(low, 1)
    const bands = Object.fromEntries((await definednessBands(DEFAULT_WORKSPACE_ID)).map((p) => [p.label, p.value]))
    expect(bands.High).toBe(1)
    expect(bands.Low).toBe(1)
    expect(bands.Medium).toBe(0)
  })

  it('refinementsByDay and comparisonsByDay count within the workspace', async () => {
    const a = await q('a', 'canonical')
    await db.insert(refinement).values({
      questionId: a,
      before: 'x',
      suggestedBy: 'llm',
      action: 'accept',
      actorRef: 'admin',
    })
    const refs = await refinementsByDay(30, DEFAULT_WORKSPACE_ID)
    expect(refs.reduce((s, r) => s + r.value, 0)).toBe(1)

    const b = await q('b', 'canonical')
    const [c] = await db
      .insert(campaign)
      .values({ prompt: 'p', comparisonAxis: 'importance' })
      .returning()
    await db.insert(comparison).values({ campaignId: c.id, questionAId: a, questionBId: b, winnerQuestionId: a, judgeRef: 'j' })
    const cmps = await comparisonsByDay(30, DEFAULT_WORKSPACE_ID)
    expect(cmps.reduce((s, r) => s + r.value, 0)).toBe(1)
  })
})
