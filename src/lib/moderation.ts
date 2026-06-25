import { asc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { moderationEvent, question } from '@/db/schema'
import { assignToNearestCluster } from '@/lib/clustering'
import { getProvider, type ReasoningProvider } from '@/lib/llm'
import { isTheme } from '@/lib/themes'

export async function listPending(limit = 50) {
  return db
    .select({ id: question.id, canonicalText: question.canonicalText, createdAt: question.createdAt })
    .from(question)
    .where(eq(question.state, 'submitted'))
    .orderBy(asc(question.createdAt))
    .limit(limit)
}

export async function approveQuestion(
  id: string,
  actorRef: string,
  provider: ReasoningProvider = getProvider(),
): Promise<{ clusterId: string; created: boolean }> {
  // Phase 1 — approve + cluster + set state, atomically. No network call inside the tx.
  let canonicalText = ''
  const result = await db.transaction(async (tx) => {
    const [q] = await tx.select().from(question).where(eq(question.id, id)).limit(1)
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

export async function rejectQuestion(id: string, actorRef: string, reason?: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [q] = await tx.select().from(question).where(eq(question.id, id)).limit(1)
    if (!q) throw new Error(`Question not found: ${id}`)
    if (q.state !== 'submitted') throw new Error(`Question ${id} is not pending (state=${q.state})`)

    await tx.insert(moderationEvent).values({ questionId: id, action: 'reject', actorRef, reason: reason ?? null })
    await tx.update(question).set({ state: 'rejected' }).where(eq(question.id, id))
  })
}
