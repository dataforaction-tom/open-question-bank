import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'

// Embed deterministically without Ollama.
vi.mock('@/lib/ollama', () => ({
  embed: vi.fn(async (text: string) => {
    const base = text.includes('resilience') ? [1, 0, 0] : [0, 1, 0]
    return [...base, ...Array(768 - base.length).fill(0)]
  }),
}))

import { db, pool } from '@/db/client'
import { campaign, campaignQuestion, comparison, datasetVersion, question, score } from '@/db/schema'
import { ensureActiveDatasetVersion } from '@/lib/dataset-version'
import {
  addQuestions,
  assertCampaignOpenForSubmission,
  createCampaign,
  openComparison,
  openForSubmission,
} from '@/lib/campaign'
import { prepareSubmission, createQuestion } from '@/lib/submission'
import { IneligibleError, NotFoundError } from '@/lib/errors'
import { GET as campaignGet } from '@/app/api/campaigns/[id]/route'
import { POST as questionsPost } from '@/app/api/questions/route'
import { getActiveWorkspaceId, ensureDefaultWorkspace } from '@/lib/workspace'

const jsonReq = (body: unknown) =>
  new Request('http://localhost/api/questions', { method: 'POST', body: JSON.stringify(body) })
const withParams = (id: string) => ({ params: Promise.resolve({ id }) })

function pad(vec: number[]): number[] {
  return [...vec, ...Array(768 - vec.length).fill(0)]
}
async function canonical(text: string): Promise<string> {
  const ws = await getActiveWorkspaceId()
  const [row] = await db
    .insert(question)
    .values({
      rawText: text,
      canonicalText: text,
      embedding: pad([0, 1, 0]),
      embeddingModelVersion: 'test@sha256:test',
      workspaceId: ws,
      datasetVersionId: (await db.select().from(datasetVersion).limit(1))[0].id,
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
  await ensureDefaultWorkspace()
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

describe('openForSubmission', () => {
  it('moves a draft campaign to open', async () => {
    const c = await createCampaign({ prompt: 'p', comparisonAxis: 'importance' })
    const opened = await openForSubmission(c.id)
    expect(opened.state).toBe('open')
  })

  it('refuses to open a non-draft campaign', async () => {
    const c = await createCampaign({ prompt: 'p', comparisonAxis: 'importance' })
    await openForSubmission(c.id)
    await expect(openForSubmission(c.id)).rejects.toBeInstanceOf(IneligibleError)
  })

  it('still allows curation and opening comparison from the open state', async () => {
    const c = await createCampaign({ prompt: 'p', comparisonAxis: 'importance' })
    await openForSubmission(c.id)
    const a = await canonical('alpha')
    const b = await canonical('bravo')
    await addQuestions(c.id, [a, b]) // curation allowed while open
    const opened = await openComparison(c.id) // open → comparing
    expect(opened.state).toBe('comparing')
  })
})

describe('assertCampaignOpenForSubmission', () => {
  it('passes for an open campaign, rejects draft, 404s for missing', async () => {
    const ws = await getActiveWorkspaceId()
    const draft = await createCampaign({ prompt: 'p', comparisonAxis: 'importance' })
    await expect(assertCampaignOpenForSubmission(draft.id, ws)).rejects.toBeInstanceOf(IneligibleError)
    await openForSubmission(draft.id)
    await expect(assertCampaignOpenForSubmission(draft.id, ws)).resolves.toMatchObject({ state: 'open' })
    await expect(
      assertCampaignOpenForSubmission('00000000-0000-0000-0000-0000000000ee', ws),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('submitting into a campaign', () => {
  it('records the originating campaign as a signal but does NOT auto-join it', async () => {
    const c = await createCampaign({ prompt: 'p', comparisonAxis: 'importance' })
    await openForSubmission(c.id)

    const result = await prepareSubmission({
      rawText: 'how do we build resilience?',
      visibility: 'public',
      originatingCampaignId: c.id,
    })
    expect(result.status).toBe('created')

    const [row] = await db.select().from(question).where(eq(question.id, result.question!.id))
    expect(row.originatingCampaignId).toBe(c.id)
    expect(row.state).toBe('submitted') // moderation still the gate — not canonical, not a member

    // The signal must NOT create a campaign membership.
    const members = await db.select().from(campaignQuestion).where(eq(campaignQuestion.campaignId, c.id))
    expect(members).toHaveLength(0)
  })

  it('rejects submitting into a campaign that is not open', async () => {
    const c = await createCampaign({ prompt: 'p', comparisonAxis: 'importance' }) // draft
    await expect(
      prepareSubmission({ rawText: 'a resilience question', visibility: 'public', originatingCampaignId: c.id }),
    ).rejects.toBeInstanceOf(IneligibleError)
    expect(await db.select().from(question)).toHaveLength(0) // nothing inserted
  })

  it('createQuestion (force-new) also carries the signal when the campaign is open', async () => {
    const c = await createCampaign({ prompt: 'p', comparisonAxis: 'importance' })
    await openForSubmission(c.id)
    const created = await createQuestion({
      rawText: 'resilience forced new',
      visibility: 'public',
      originatingCampaignId: c.id,
    })
    expect(created.originatingCampaignId).toBe(c.id)
  })
})

describe('routes', () => {
  it('GET /api/campaigns/:id returns info for an open campaign and 404s for a draft', async () => {
    const draft = await createCampaign({ prompt: 'hidden draft', comparisonAxis: 'importance' })
    const draftRes = await campaignGet(new Request('http://localhost'), withParams(draft.id))
    expect(draftRes.status).toBe(404)

    await openForSubmission(draft.id)
    const openRes = await campaignGet(new Request('http://localhost'), withParams(draft.id))
    expect(openRes.status).toBe(200)
    expect(await openRes.json()).toMatchObject({ prompt: 'hidden draft', state: 'open' })
  })

  it('POST /api/questions with campaignId 201s into an open campaign; 409s for a draft', async () => {
    const c = await createCampaign({ prompt: 'p', comparisonAxis: 'importance' })
    await openForSubmission(c.id)
    const ok = await questionsPost(
      jsonReq({ rawText: 'resilience via route', visibility: 'public', decision: { type: 'new' }, campaignId: c.id }),
    )
    expect(ok.status).toBe(201)

    const draft = await createCampaign({ prompt: 'p2', comparisonAxis: 'importance' })
    const blocked = await questionsPost(
      jsonReq({ rawText: 'resilience blocked', visibility: 'public', decision: { type: 'new' }, campaignId: draft.id }),
    )
    expect(blocked.status).toBe(409)
  })

  it('POST /api/questions 400s on a malformed campaignId', async () => {
    const res = await questionsPost(
      jsonReq({ rawText: 'x', visibility: 'public', decision: { type: 'new' }, campaignId: 'not-a-uuid' }),
    )
    expect(res.status).toBe(400)
  })
})
