import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { campaign, campaignQuestion, comparison, datasetVersion, question, score, workspace } from '@/db/schema'
import { IneligibleError, NotFoundError } from '@/lib/errors'
import { addQuestions, closeCampaign, createCampaign, openComparison } from '@/lib/campaign'
import { recordComparison } from '@/lib/comparison'
import { getAgenda, getQuestionEvidence } from '@/lib/agenda'
import { resetWorkspaceCache, DEFAULT_WORKSPACE_ID } from '@/lib/workspace'

let versionId: number
const MISSING = '00000000-0000-0000-0000-000000000000'

function pad(vec: number[]): number[] {
  return [...vec, ...Array(768 - vec.length).fill(0)]
}
async function q(text: string): Promise<string> {
  const [row] = await db
    .insert(question)
    .values({
      rawText: text,
      canonicalText: text,
      embedding: pad([1, 0, 0]),
      embeddingModelVersion: 'test@sha256:test',
      datasetVersionId: versionId,
      visibility: 'public',
      state: 'canonical',
    })
    .returning()
  return row.id
}

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ${comparison} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${score} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${campaignQuestion} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${campaign} RESTART IDENTITY CASCADE`)
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

// Build a closed campaign where `a` clearly beats `b`.
async function closedCampaign(): Promise<{ cid: string; a: string; b: string }> {
  const a = await q('Question A')
  const b = await q('Question B')
  const c = await createCampaign({ prompt: 'most important?', comparisonAxis: 'importance' })
  await addQuestions(c.id, [a, b])
  await openComparison(c.id)
  await recordComparison({ campaignId: c.id, questionAId: a, questionBId: b, winnerQuestionId: a, judgeRef: 'j1' })
  await closeCampaign(c.id)
  return { cid: c.id, a, b }
}

describe('getAgenda', () => {
  it('404 for a missing campaign', async () => {
    await expect(getAgenda(MISSING)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('409 for a campaign that is not closed', async () => {
    const a = await q('a')
    const b = await q('b')
    const c = await createCampaign({ prompt: 'p', comparisonAxis: 'importance' })
    await addQuestions(c.id, [a, b])
    await openComparison(c.id)
    await expect(getAgenda(c.id)).rejects.toBeInstanceOf(IneligibleError)
  })

  it('returns ranked items (winner first) with 1-based ranks and score shape', async () => {
    const { cid, a } = await closedCampaign()
    const agenda = await getAgenda(cid)
    expect(agenda.campaign.comparisonAxis).toBe('importance')
    expect(agenda.campaign.closesAt).toBeInstanceOf(Date)
    expect(agenda.items).toHaveLength(2)
    expect(agenda.items[0].rank).toBe(1)
    expect(agenda.items[1].rank).toBe(2)
    expect(agenda.items[0].questionId).toBe(a) // a won, so a ranks first (higher mu)
    expect(agenda.items[0].mu).toBeGreaterThan(agenda.items[1].mu)
    expect(typeof agenda.items[0].sigma).toBe('number')
    expect(agenda.items[0].nComparisons).toBe(1)
    // variantCount is present (0 when no merges)
    expect(agenda.items[0].variantCount).toBe(0)
  })

  it('includes variantCount as a community demand signal on agenda items', async () => {
    const a = await q('Question A')
    const b = await q('Question B')
    // Merge 3 variants into A, 1 into B
    await db.insert(question).values([
      {
        rawText: 'va1', canonicalText: 'va1', embedding: pad([1, 0, 0]),
        embeddingModelVersion: 'test@sha256:test', datasetVersionId: versionId,
        visibility: 'public', state: 'merged_as_variant', canonicalOf: a,
      },
      {
        rawText: 'va2', canonicalText: 'va2', embedding: pad([1, 0, 0]),
        embeddingModelVersion: 'test@sha256:test', datasetVersionId: versionId,
        visibility: 'public', state: 'merged_as_variant', canonicalOf: a,
      },
      {
        rawText: 'va3', canonicalText: 'va3', embedding: pad([1, 0, 0]),
        embeddingModelVersion: 'test@sha256:test', datasetVersionId: versionId,
        visibility: 'public', state: 'merged_as_variant', canonicalOf: a,
      },
      {
        rawText: 'vb1', canonicalText: 'vb1', embedding: pad([0, 1, 0]),
        embeddingModelVersion: 'test@sha256:test', datasetVersionId: versionId,
        visibility: 'public', state: 'merged_as_variant', canonicalOf: b,
      },
    ])
    const c = await createCampaign({ prompt: 'most important?', comparisonAxis: 'importance' })
    await addQuestions(c.id, [a, b])
    await openComparison(c.id)
    await recordComparison({ campaignId: c.id, questionAId: a, questionBId: b, winnerQuestionId: a, judgeRef: 'j1' })
    await closeCampaign(c.id)

    const agenda = await getAgenda(c.id)
    const itemA = agenda.items.find((it) => it.questionId === a)!
    const itemB = agenda.items.find((it) => it.questionId === b)!
    expect(itemA.variantCount).toBe(3)
    expect(itemB.variantCount).toBe(1)
  })
})

describe('getQuestionEvidence', () => {
  it("returns the comparison outcomes from the question's perspective, no judge_ref", async () => {
    const { cid, a, b } = await closedCampaign()
    const evA = await getQuestionEvidence(cid, a)
    expect(evA).toHaveLength(1)
    expect(evA[0].outcome).toBe('won')
    expect(evA[0].opponentText).toBe('Question B')
    expect(evA[0].timestamp).toBeInstanceOf(Date)
    expect(evA[0]).not.toHaveProperty('judgeRef')
    expect(evA[0]).not.toHaveProperty('judge_ref')

    const evB = await getQuestionEvidence(cid, b)
    expect(evB[0].outcome).toBe('lost')
    expect(evB[0].opponentText).toBe('Question A')
  })

  it('409 if the campaign is not closed', async () => {
    const a = await q('a')
    const b = await q('b')
    const c = await createCampaign({ prompt: 'p', comparisonAxis: 'importance' })
    await addQuestions(c.id, [a, b])
    await openComparison(c.id)
    await expect(getQuestionEvidence(c.id, a)).rejects.toBeInstanceOf(IneligibleError)
  })

  it('404 for a question that is not a member of the campaign', async () => {
    const { cid } = await closedCampaign()
    const outsider = await q('outsider')
    await expect(getQuestionEvidence(cid, outsider)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('lists every comparison a question took part in, time-ordered, incl. a draw', async () => {
    const a = await q('Question A')
    const b = await q('Question B')
    const c = await q('Question C')
    const camp = await createCampaign({ prompt: 'p', comparisonAxis: 'importance' })
    await addQuestions(camp.id, [a, b, c])
    await openComparison(camp.id)
    // A wins vs B, then A draws vs C.
    await recordComparison({ campaignId: camp.id, questionAId: a, questionBId: b, winnerQuestionId: a, judgeRef: 'j1' })
    await recordComparison({ campaignId: camp.id, questionAId: a, questionBId: c, winnerQuestionId: null, judgeRef: 'j1' })
    await closeCampaign(camp.id)

    const evA = await getQuestionEvidence(camp.id, a)
    expect(evA).toHaveLength(2)
    // Time-ordered: the win against B comes before the draw against C.
    expect(evA[0]).toMatchObject({ outcome: 'won', opponentText: 'Question B' })
    expect(evA[1]).toMatchObject({ outcome: 'drew', opponentText: 'Question C' })
  })
})

describe('agenda — workspace scoping', () => {
  const OTHER_WS = '00000000-0000-0000-0000-000000000002'

  afterEach(() => resetWorkspaceCache())

  it('getAgenda throws NotFoundError for a campaign in another workspace', async () => {
    await db.insert(workspace).values({ id: OTHER_WS, slug: 'other', name: 'Other' })
    const [foreign] = await db.insert(campaign).values({
      prompt: 'foreign closed campaign',
      comparisonAxis: 'importance',
      workspaceId: OTHER_WS,
      state: 'closed',
    }).returning()

    await expect(getAgenda(foreign.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('getQuestionEvidence throws NotFoundError for a campaign in another workspace', async () => {
    await db.insert(workspace).values({ id: OTHER_WS, slug: 'other', name: 'Other' })
    const [foreign] = await db.insert(campaign).values({
      prompt: 'foreign closed campaign',
      comparisonAxis: 'importance',
      workspaceId: OTHER_WS,
      state: 'closed',
    }).returning()

    await expect(getQuestionEvidence(foreign.id, MISSING)).rejects.toBeInstanceOf(NotFoundError)
  })
})
