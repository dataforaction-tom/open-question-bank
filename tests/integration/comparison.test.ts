import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { campaign, campaignQuestion, comparison, datasetVersion, question, score, workspace } from '@/db/schema'
import { IneligibleError, NotFoundError } from '@/lib/errors'
import { addQuestions, createCampaign, openComparison } from '@/lib/campaign'
import { nextPair, recomputeScores, recordComparison } from '@/lib/comparison'
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
async function openCampaignWith(ids: string[]): Promise<string> {
  const c = await createCampaign({ prompt: 'p', comparisonAxis: 'importance' })
  await addQuestions(c.id, ids)
  await openComparison(c.id)
  return c.id
}
async function scoreFor(campaignId: string, questionId: string) {
  const [row] = await db
    .select()
    .from(score)
    .where(and(eq(score.campaignId, campaignId), eq(score.questionId, questionId)))
  return row
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

describe('recordComparison', () => {
  it('appends a log row and moves scores (winner up, loser down)', async () => {
    const a = await q('a')
    const b = await q('b')
    const cid = await openCampaignWith([a, b])
    const res = await recordComparison({
      campaignId: cid,
      questionAId: a,
      questionBId: b,
      winnerQuestionId: a,
      judgeRef: 'admin',
      servedReason: 'test',
    })
    expect(res.a.mu).toBeGreaterThan(25)
    expect(res.b.mu).toBeLessThan(25)
    const log = await db.select().from(comparison).where(eq(comparison.campaignId, cid))
    expect(log).toHaveLength(1)
    expect(log[0].winnerQuestionId).toBe(a)
    expect((await scoreFor(cid, a)).nComparisons).toBe(1)
  })

  it('records a draw (winner null) and decreases both sigmas', async () => {
    const a = await q('a')
    const b = await q('b')
    const cid = await openCampaignWith([a, b])
    const res = await recordComparison({
      campaignId: cid,
      questionAId: a,
      questionBId: b,
      winnerQuestionId: null,
      judgeRef: 'admin',
    })
    expect(res.a.sigma).toBeLessThan(25 / 3)
    expect(res.b.sigma).toBeLessThan(25 / 3)
  })

  it('rejects a comparison on a non-comparing campaign', async () => {
    const a = await q('a')
    const b = await q('b')
    const c = await createCampaign({ prompt: 'p', comparisonAxis: 'importance' })
    await expect(
      recordComparison({ campaignId: c.id, questionAId: a, questionBId: b, winnerQuestionId: a, judgeRef: 'admin' }),
    ).rejects.toBeInstanceOf(IneligibleError)
  })

  it('rejects a question that is not a member', async () => {
    const a = await q('a')
    const b = await q('b')
    const outsider = await q('c')
    const cid = await openCampaignWith([a, b])
    await expect(
      recordComparison({ campaignId: cid, questionAId: a, questionBId: outsider, winnerQuestionId: a, judgeRef: 'admin' }),
    ).rejects.toBeInstanceOf(IneligibleError)
  })

  it('rejects a winner that is neither A nor B', async () => {
    const a = await q('a')
    const b = await q('b')
    const cid = await openCampaignWith([a, b])
    await expect(
      recordComparison({ campaignId: cid, questionAId: a, questionBId: b, winnerQuestionId: MISSING, judgeRef: 'admin' }),
    ).rejects.toBeInstanceOf(IneligibleError)
  })

  it('rejects comparing a question with itself', async () => {
    const a = await q('a')
    const b = await q('b')
    const cid = await openCampaignWith([a, b])
    await expect(
      recordComparison({ campaignId: cid, questionAId: a, questionBId: a, winnerQuestionId: a, judgeRef: 'admin' }),
    ).rejects.toBeInstanceOf(IneligibleError)
  })

  it('rejects the same judge judging the same pair twice (either order)', async () => {
    const a = await q('a')
    const b = await q('b')
    const cid = await openCampaignWith([a, b])
    await recordComparison({ campaignId: cid, questionAId: a, questionBId: b, winnerQuestionId: a, judgeRef: 'j1' })
    await expect(
      recordComparison({ campaignId: cid, questionAId: a, questionBId: b, winnerQuestionId: b, judgeRef: 'j1' }),
    ).rejects.toBeInstanceOf(IneligibleError)
    await expect(
      recordComparison({ campaignId: cid, questionAId: b, questionBId: a, winnerQuestionId: a, judgeRef: 'j1' }),
    ).rejects.toBeInstanceOf(IneligibleError)
  })

  it('lets a different judge judge the same pair', async () => {
    const a = await q('a')
    const b = await q('b')
    const cid = await openCampaignWith([a, b])
    await recordComparison({ campaignId: cid, questionAId: a, questionBId: b, winnerQuestionId: a, judgeRef: 'j1' })
    const res = await recordComparison({ campaignId: cid, questionAId: a, questionBId: b, winnerQuestionId: b, judgeRef: 'j2' })
    expect(res.b.mu).toBeGreaterThan(res.a.mu)
  })

  it('serialises two concurrent judgements of the same pair — exactly one persists', async () => {
    const a = await q('a')
    const b = await q('b')
    const cid = await openCampaignWith([a, b])
    // The FOR UPDATE lock must make these two race-but-serialise: one wins,
    // the other's duplicate guard fires. (Regression guard for the lock.)
    const attempt = () =>
      recordComparison({ campaignId: cid, questionAId: a, questionBId: b, winnerQuestionId: a, judgeRef: 'jc' })
        .then(() => 'ok' as const)
        .catch((e) => e)
    const results = await Promise.all([attempt(), attempt()])
    expect(results.filter((r) => r === 'ok')).toHaveLength(1)
    expect(results.filter((r) => r instanceof IneligibleError)).toHaveLength(1)
    const rows = await db.select().from(comparison).where(eq(comparison.campaignId, cid))
    expect(rows).toHaveLength(1)
  })
})

describe('nextPair', () => {
  it('returns a pair with a served reason while comparing', async () => {
    const a = await q('a')
    const b = await q('b')
    const cid = await openCampaignWith([a, b])
    const pair = await nextPair(cid, 'admin')
    expect(pair).not.toBeNull()
    expect(new Set([pair!.a.id, pair!.b.id])).toEqual(new Set([a, b]))
    expect(pair!.a.canonicalText).toBeTruthy()
    expect(pair!.servedReason).toMatch(/Δμ=/)
  })

  it('404s on a missing campaign', async () => {
    await expect(nextPair(MISSING, 'admin')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('rejects a campaign that is not comparing', async () => {
    const c = await createCampaign({ prompt: 'p', comparisonAxis: 'importance' })
    await expect(nextPair(c.id, 'admin')).rejects.toBeInstanceOf(IneligibleError)
  })

  it('never serves a judge a pair they already judged', async () => {
    const a = await q('a')
    const b = await q('b')
    const c = await q('c')
    const cid = await openCampaignWith([a, b, c])
    await recordComparison({ campaignId: cid, questionAId: a, questionBId: b, winnerQuestionId: a, judgeRef: 'j1' })
    const pair = await nextPair(cid, 'j1')
    expect(pair).not.toBeNull()
    expect([pair!.a.id, pair!.b.id]).toContain(c)
    await recordComparison({ campaignId: cid, questionAId: a, questionBId: c, winnerQuestionId: a, judgeRef: 'j1' })
    await recordComparison({ campaignId: cid, questionAId: b, questionBId: c, winnerQuestionId: b, judgeRef: 'j1' })
    expect(await nextPair(cid, 'j1')).toBeNull()
    expect(await nextPair(cid, 'j2')).not.toBeNull()
  })
})

describe('recomputeScores', () => {
  it('replay equals the incremental result', async () => {
    const a = await q('a')
    const b = await q('b')
    const c = await q('c')
    const cid = await openCampaignWith([a, b, c])
    await recordComparison({ campaignId: cid, questionAId: a, questionBId: b, winnerQuestionId: a, judgeRef: 'admin' })
    await recordComparison({ campaignId: cid, questionAId: b, questionBId: c, winnerQuestionId: c, judgeRef: 'admin' })
    await recordComparison({ campaignId: cid, questionAId: a, questionBId: c, winnerQuestionId: null, judgeRef: 'admin' })

    const before = new Map((await db.select().from(score).where(eq(score.campaignId, cid))).map((r) => [r.questionId, r]))
    // Wipe the projection first, so this proves a true rebuild from the log —
    // not just re-applying deltas onto the existing rows.
    await db.delete(score).where(eq(score.campaignId, cid))
    const replay = await recomputeScores(cid)
    for (const r of replay) {
      const prev = before.get(r.questionId)!
      expect(r.mu).toBeCloseTo(prev.mu, 6)
      expect(r.sigma).toBeCloseTo(prev.sigma, 6)
      expect(r.nComparisons).toBe(prev.nComparisons)
    }
  })
})

describe('comparison — workspace scoping', () => {
  const OTHER_WS = '00000000-0000-0000-0000-000000000002'

  afterEach(() => resetWorkspaceCache())

  it('nextPair throws NotFoundError for a campaign in another workspace', async () => {
    await db.insert(workspace).values({ id: OTHER_WS, slug: 'other', name: 'Other' })
    const [foreign] = await db.insert(campaign).values({
      prompt: 'foreign campaign',
      comparisonAxis: 'importance',
      workspaceId: OTHER_WS,
      state: 'comparing',
    }).returning()

    await expect(nextPair(foreign.id, 'judge')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('recordComparison throws NotFoundError for a campaign in another workspace', async () => {
    await db.insert(workspace).values({ id: OTHER_WS, slug: 'other', name: 'Other' })
    const [foreign] = await db.insert(campaign).values({
      prompt: 'foreign campaign',
      comparisonAxis: 'importance',
      workspaceId: OTHER_WS,
      state: 'comparing',
    }).returning()

    await expect(
      recordComparison({
        campaignId: foreign.id,
        questionAId: MISSING,
        questionBId: '00000000-0000-0000-0000-000000000099',
        winnerQuestionId: null,
        judgeRef: 'judge',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
