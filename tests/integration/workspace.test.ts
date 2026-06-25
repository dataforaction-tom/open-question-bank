import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import {
  campaign,
  campaignQuestion,
  comparison,
  datasetVersion,
  question,
  score,
  workspace,
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_SLUG,
} from '@/db/schema'
import {
  ensureActiveDatasetVersion,
  getActiveDatasetVersion,
} from '@/lib/dataset-version'
import { addQuestions, createCampaign, listCampaigns, listCanonical } from '@/lib/campaign'
import { IneligibleError } from '@/lib/errors'
import { listPublicCampaigns, listPublicQuestions } from '@/lib/discovery'
import {
  ensureDefaultWorkspace,
  getActiveWorkspaceId,
  resetWorkspaceCache,
} from '@/lib/workspace'

// A second workspace alongside the seeded default — the seam must keep them fully partitioned.
const OTHER_WORKSPACE_ID = '00000000-0000-0000-0000-0000000000a2'

let versionA: number // default workspace's active dataset version
let versionB: number // other workspace's active dataset version

function pad(vec: number[]): number[] {
  return [...vec, ...Array(768 - vec.length).fill(0)]
}

async function q(
  text: string,
  workspaceId: string,
  datasetVersionId: number,
  state: 'submitted' | 'canonical' | 'ranked',
): Promise<string> {
  const [row] = await db
    .insert(question)
    .values({
      rawText: text,
      canonicalText: text,
      embedding: pad([1, 0, 0]),
      embeddingModelVersion: 'test@sha256:test',
      workspaceId,
      datasetVersionId,
      visibility: 'public',
      state,
    })
    .returning()
  return row.id
}

beforeEach(async () => {
  // Full reset, including the workspace table; CASCADE clears the FK-dependent rows.
  await db.execute(sql`TRUNCATE TABLE ${comparison} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${score} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${campaignQuestion} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${campaign} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${question} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${datasetVersion} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${workspace} RESTART IDENTITY CASCADE`)
  resetWorkspaceCache()

  // Re-seed the default workspace (other test files depend on it existing) plus a second one.
  await ensureDefaultWorkspace()
  await db
    .insert(workspace)
    .values({ id: OTHER_WORKSPACE_ID, slug: 'other', name: 'Other workspace' })

  const a = await ensureActiveDatasetVersion(
    { embeddingModel: 'test', embeddingModelDigest: 'sha256:a', embeddingDim: 768, dedupThreshold: 0.15 },
    DEFAULT_WORKSPACE_ID,
  )
  const b = await ensureActiveDatasetVersion(
    { embeddingModel: 'test', embeddingModelDigest: 'sha256:b', embeddingDim: 768, dedupThreshold: 0.15 },
    OTHER_WORKSPACE_ID,
  )
  versionA = a.id
  versionB = b.id
})

afterAll(async () => {
  await pool.end()
})

describe('workspace seam', () => {
  it('seeds the default workspace and resolves it as active', async () => {
    expect(await getActiveWorkspaceId()).toBe(DEFAULT_WORKSPACE_ID)
    const [ws] = await db
      .select()
      .from(workspace)
      .where(eq(workspace.slug, DEFAULT_WORKSPACE_SLUG))
    expect(ws.id).toBe(DEFAULT_WORKSPACE_ID)
  })

  it('keeps one active dataset version PER workspace, not globally', async () => {
    const active = await db
      .select()
      .from(datasetVersion)
      .where(eq(datasetVersion.isActive, true))
    // One active row in EACH workspace — the per-workspace partial unique index allows this.
    expect(active).toHaveLength(2)
    expect((await getActiveDatasetVersion(DEFAULT_WORKSPACE_ID))?.id).toBe(versionA)
    expect((await getActiveDatasetVersion(OTHER_WORKSPACE_ID))?.id).toBe(versionB)
  })

  it('partitions the public question bank by workspace', async () => {
    const inDefault = await q('default canonical', DEFAULT_WORKSPACE_ID, versionA, 'canonical')
    const inOther = await q('other canonical', OTHER_WORKSPACE_ID, versionB, 'canonical')

    const defaultRows = await listPublicQuestions(200, DEFAULT_WORKSPACE_ID)
    const otherRows = await listPublicQuestions(200, OTHER_WORKSPACE_ID)

    expect(defaultRows.map((r) => r.id)).toEqual([inDefault])
    expect(otherRows.map((r) => r.id)).toEqual([inOther])
  })

  it('partitions canonical listing and campaigns by workspace', async () => {
    await q('default canon', DEFAULT_WORKSPACE_ID, versionA, 'canonical')
    await q('other canon', OTHER_WORKSPACE_ID, versionB, 'canonical')

    expect((await listCanonical(100, DEFAULT_WORKSPACE_ID)).map((r) => r.canonicalText)).toEqual([
      'default canon',
    ])
    expect((await listCanonical(100, OTHER_WORKSPACE_ID)).map((r) => r.canonicalText)).toEqual([
      'other canon',
    ])

    await createCampaign({ prompt: 'default campaign', comparisonAxis: 'importance', workspaceId: DEFAULT_WORKSPACE_ID })
    await createCampaign({ prompt: 'other campaign', comparisonAxis: 'importance', workspaceId: OTHER_WORKSPACE_ID })

    expect((await listCampaigns(DEFAULT_WORKSPACE_ID)).map((c) => c.prompt)).toEqual(['default campaign'])
    expect((await listCampaigns(OTHER_WORKSPACE_ID)).map((c) => c.prompt)).toEqual(['other campaign'])
  })

  it('partitions the public campaign index by workspace', async () => {
    // A comparing campaign in each workspace; each index must show only its own.
    async function comparingCampaign(workspaceId: string, versionId: number, label: string) {
      const a = await q(`${label} A`, workspaceId, versionId, 'canonical')
      const b = await q(`${label} B`, workspaceId, versionId, 'canonical')
      const c = await createCampaign({ prompt: `${label} campaign`, comparisonAxis: 'importance', workspaceId })
      await db.insert(campaignQuestion).values([
        { campaignId: c.id, questionId: a },
        { campaignId: c.id, questionId: b },
      ])
      await db.update(campaign).set({ state: 'comparing' }).where(eq(campaign.id, c.id))
      return c.id
    }
    const defaultCampaign = await comparingCampaign(DEFAULT_WORKSPACE_ID, versionA, 'default')
    const otherCampaign = await comparingCampaign(OTHER_WORKSPACE_ID, versionB, 'other')

    const defaultIndex = await listPublicCampaigns(DEFAULT_WORKSPACE_ID)
    const otherIndex = await listPublicCampaigns(OTHER_WORKSPACE_ID)

    expect(defaultIndex.openForJudging.map((c) => c.id)).toEqual([defaultCampaign])
    expect(otherIndex.openForJudging.map((c) => c.id)).toEqual([otherCampaign])
  })

  it('refuses to add a question from another workspace into a campaign', async () => {
    const foreign = await q('foreign canonical', OTHER_WORKSPACE_ID, versionB, 'canonical')
    const c = await createCampaign({
      prompt: 'default campaign',
      comparisonAxis: 'importance',
      workspaceId: DEFAULT_WORKSPACE_ID,
    })
    await expect(addQuestions(c.id, [foreign])).rejects.toBeInstanceOf(IneligibleError)
  })

  it('defaults unscoped writes to the active (default) workspace', async () => {
    // No workspaceId passed → lands in the default workspace and is visible only there.
    await createCampaign({ prompt: 'unscoped', comparisonAxis: 'importance' })
    const inDefault = await db
      .select()
      .from(campaign)
      .where(and(eq(campaign.workspaceId, DEFAULT_WORKSPACE_ID), eq(campaign.prompt, 'unscoped')))
    expect(inDefault).toHaveLength(1)
  })
})
