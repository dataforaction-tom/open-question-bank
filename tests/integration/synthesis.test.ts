import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { campaign, campaignQuestion, comparison, datasetVersion, question, score, synthesis, workspace } from '@/db/schema'
import { IneligibleError, NotFoundError } from '@/lib/errors'
import { ProviderError, type ReasoningProvider, type SynthesisResult } from '@/lib/llm'
import { addQuestions, closeCampaign, createCampaign, openComparison } from '@/lib/campaign'
import { recordComparison } from '@/lib/comparison'
import {
  editSynthesis,
  endorseSynthesis,
  listEndorsedSyntheses,
  listSyntheses,
  proposeSyntheses,
  rejectSynthesis,
} from '@/lib/synthesis'
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

function stubProvider(sourceQuestionIds: string[]): Pick<ReasoningProvider, 'synthesise'> {
  return {
    synthesise: async (): Promise<SynthesisResult> => ({
      proposals: [{ synthesisedText: 'Synth', sourceQuestionIds, rationale: 'because' }],
      model: 'mock',
      modelVersion: 'mock',
    }),
  }
}
const failingProvider: Pick<ReasoningProvider, 'synthesise'> = {
  synthesise: async () => {
    throw new ProviderError('model down')
  },
}

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

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ${synthesis} RESTART IDENTITY CASCADE`)
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

describe('proposeSyntheses', () => {
  it('404 for a missing campaign, 409 for a non-closed one', async () => {
    await expect(proposeSyntheses(MISSING, stubProvider([]))).rejects.toBeInstanceOf(NotFoundError)
    const a = await q('a')
    const b = await q('b')
    const c = await createCampaign({ prompt: 'p', comparisonAxis: 'importance' })
    await addQuestions(c.id, [a, b])
    await openComparison(c.id)
    await expect(proposeSyntheses(c.id, stubProvider([a]))).rejects.toBeInstanceOf(IneligibleError)
  })

  it('persists a proposal with validated lineage', async () => {
    const { cid, a, b } = await closedCampaign()
    const rows = await proposeSyntheses(cid, stubProvider([a, b]))
    expect(rows).toHaveLength(1)
    expect(rows[0].proposedBy).toBe('llm')
    expect(rows[0].status).toBe('proposed')
    expect(rows[0].endorsedBy).toEqual([])
    expect(new Set(rows[0].sourceQuestionIds)).toEqual(new Set([a, b]))
  })

  it('drops hallucinated source ids and skips a proposal with zero valid sources', async () => {
    const { cid, a } = await closedCampaign()
    const ok = await proposeSyntheses(cid, stubProvider([a, MISSING]))
    expect(ok[0].sourceQuestionIds).toEqual([a]) // MISSING dropped
    const none = await proposeSyntheses(cid, stubProvider([MISSING]))
    expect(none).toHaveLength(0) // skipped entirely
  })

  it('propagates a ProviderError', async () => {
    const { cid } = await closedCampaign()
    await expect(proposeSyntheses(cid, failingProvider)).rejects.toBeInstanceOf(ProviderError)
  })
})

describe('endorse / edit / reject', () => {
  async function proposeOne(): Promise<{ cid: string; id: string; a: string; b: string }> {
    const { cid, a, b } = await closedCampaign()
    const [row] = await proposeSyntheses(cid, stubProvider([a, b]))
    return { cid, id: row.id, a, b }
  }

  it('endorse appends the actor, idempotently, and only while proposed', async () => {
    const { id } = await proposeOne()
    const first = await endorseSynthesis(id, 'admin')
    expect(first.endorsedBy).toEqual(['admin'])
    const again = await endorseSynthesis(id, 'admin')
    expect(again.endorsedBy).toEqual(['admin']) // idempotent
    await rejectSynthesis(id, 'admin')
    await expect(endorseSynthesis(id, 'admin')).rejects.toBeInstanceOf(IneligibleError)
  })

  it('edit inserts a new endorsed version and supersedes the old row', async () => {
    const { id } = await proposeOne()
    const edited = await editSynthesis(id, 'A clearer synthesis', 'admin')
    expect(edited.version).toBe(2)
    expect(edited.supersedesId).toBe(id)
    expect(edited.proposedBy).toBe('human')
    expect(edited.synthesisedText).toBe('A clearer synthesis')
    expect(edited.endorsedBy).toEqual(['admin'])
    const [old] = await db.select().from(synthesis).where(eq(synthesis.id, id))
    expect(old.status).toBe('superseded')
  })

  it('reject marks the row rejected', async () => {
    const { id } = await proposeOne()
    const rejected = await rejectSynthesis(id, 'admin')
    expect(rejected.status).toBe('rejected')
  })

  it('refuses to edit a row that is no longer proposed', async () => {
    const { id } = await proposeOne()
    await rejectSynthesis(id, 'admin')
    await expect(editSynthesis(id, 'too late', 'admin')).rejects.toBeInstanceOf(IneligibleError)
  })

  it('404 for an unknown synthesis', async () => {
    await expect(endorseSynthesis(MISSING, 'admin')).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('listSyntheses / listEndorsedSyntheses', () => {
  it('listSyntheses returns every row; listEndorsedSyntheses only endorsed-live, with lineage and no leakage', async () => {
    const { cid, a, b } = await closedCampaign()
    const [proposed] = await proposeSyntheses(cid, stubProvider([a, b]))
    await proposeSyntheses(cid, stubProvider([a])) // a second, unendorsed proposal
    await endorseSynthesis(proposed.id, 'admin')

    expect(await listSyntheses(cid)).toHaveLength(2)

    const endorsed = await listEndorsedSyntheses(cid)
    expect(endorsed).toHaveLength(1)
    expect(endorsed[0].synthesisedText).toBe('Synth')
    expect(endorsed[0].sources.map((s) => s.questionId).sort()).toEqual([a, b].sort())
    expect(endorsed[0].sources[0].canonicalText).toBeTruthy()
    expect(endorsed[0]).not.toHaveProperty('endorsedBy')
    expect(endorsed[0]).not.toHaveProperty('model')
  })

  it('listEndorsedSyntheses is closed-only', async () => {
    const a = await q('a')
    const b = await q('b')
    const c = await createCampaign({ prompt: 'p', comparisonAxis: 'importance' })
    await addQuestions(c.id, [a, b])
    await openComparison(c.id)
    await expect(listEndorsedSyntheses(c.id)).rejects.toBeInstanceOf(IneligibleError)
  })
})

describe('synthesis — workspace scoping', () => {
  const OTHER_WS = '00000000-0000-0000-0000-000000000002'

  afterEach(() => resetWorkspaceCache())

  it('listEndorsedSyntheses throws NotFoundError for a campaign in another workspace', async () => {
    await db.insert(workspace).values({ id: OTHER_WS, slug: 'other', name: 'Other' })
    const [foreign] = await db.insert(campaign).values({
      prompt: 'foreign closed campaign',
      comparisonAxis: 'importance',
      workspaceId: OTHER_WS,
      state: 'closed',
    }).returning()

    await expect(listEndorsedSyntheses(foreign.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('listSyntheses throws NotFoundError for a campaign in another workspace', async () => {
    await db.insert(workspace).values({ id: OTHER_WS, slug: 'other', name: 'Other' })
    const [foreign] = await db.insert(campaign).values({
      prompt: 'foreign campaign',
      comparisonAxis: 'importance',
      workspaceId: OTHER_WS,
      state: 'closed',
    }).returning()

    await expect(listSyntheses(foreign.id)).rejects.toBeInstanceOf(NotFoundError)
  })
})
