import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { campaign, moderationEvent, question } from '@/db/schema'
import { assignToNearestCluster } from '@/lib/clustering'
import { getProvider, type ReasoningProvider } from '@/lib/llm'
import { isTheme } from '@/lib/themes'
import { getActiveWorkspaceId } from '@/lib/workspace'

export async function listPending(limit = 50, workspaceId?: string) {
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  return db
    .select({
      id: question.id,
      canonicalText: question.canonicalText,
      createdAt: question.createdAt,
      originatingCampaignId: question.originatingCampaignId,
      originatingCampaignPrompt: campaign.prompt,
    })
    .from(question)
    .leftJoin(campaign, eq(question.originatingCampaignId, campaign.id))
    .where(and(eq(question.state, 'submitted'), eq(question.workspaceId, ws)))
    .orderBy(asc(question.createdAt))
    .limit(limit)
}

export async function approveQuestion(
  id: string,
  actorRef: string,
  provider: ReasoningProvider = getProvider(),
  workspaceId?: string,
): Promise<{ clusterId: string; created: boolean }> {
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  // Phase 1 — approve + cluster + set state, atomically. No network call inside the tx.
  let canonicalText = ''
  const result = await db.transaction(async (tx) => {
    const [q] = await tx
      .select()
      .from(question)
      .where(and(eq(question.id, id), eq(question.workspaceId, ws)))
      .limit(1)
    if (!q) throw new Error(`Question not found: ${id}`)
    if (q.state !== 'submitted') throw new Error(`Question ${id} is not pending (state=${q.state})`)
    canonicalText = q.canonicalText

    await tx.insert(moderationEvent).values({ questionId: id, action: 'approve', actorRef })
    const r = await assignToNearestCluster(id, tx)
    await tx.update(question).set({ state: 'clustered' }).where(eq(question.id, id))
    return r
  })

  // Phase 2 — advisory theme classification (spec §7). Must NOT fail the approval: a provider
  // error or a non-theme result simply leaves `theme` null.
  try {
    const { theme } = await provider.classify(canonicalText)
    if (isTheme(theme)) {
      await db.update(question).set({ theme }).where(eq(question.id, id))
    }
  } catch {
    // Approval already committed; leave theme null.
  }

  return result
}

export async function rejectQuestion(
  id: string,
  actorRef: string,
  reason?: string,
  workspaceId?: string,
): Promise<void> {
  const ws = workspaceId ?? (await getActiveWorkspaceId())
  await db.transaction(async (tx) => {
    const [q] = await tx
      .select()
      .from(question)
      .where(and(eq(question.id, id), eq(question.workspaceId, ws)))
      .limit(1)
    if (!q) throw new Error(`Question not found: ${id}`)
    if (q.state !== 'submitted') throw new Error(`Question ${id} is not pending (state=${q.state})`)

    await tx.insert(moderationEvent).values({ questionId: id, action: 'reject', actorRef, reason: reason ?? null })
    await tx.update(question).set({ state: 'rejected' }).where(eq(question.id, id))
  })
}