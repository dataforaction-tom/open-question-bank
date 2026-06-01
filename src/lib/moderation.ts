import { asc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { moderationEvent, question } from '@/db/schema'
import { assignToNearestCluster } from '@/lib/clustering'

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
): Promise<{ clusterId: string; created: boolean }> {
  return db.transaction(async (tx) => {
    const [q] = await tx.select().from(question).where(eq(question.id, id)).limit(1)
    if (!q) throw new Error(`Question not found: ${id}`)
    if (q.state !== 'submitted') throw new Error(`Question ${id} is not pending (state=${q.state})`)

    await tx.insert(moderationEvent).values({ questionId: id, action: 'approve', actorRef })
    const result = await assignToNearestCluster(id, tx)
    await tx.update(question).set({ state: 'clustered' }).where(eq(question.id, id))
    return result
  })
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
