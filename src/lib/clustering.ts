import { alias } from 'drizzle-orm/pg-core'
import { asc, cosineDistance, eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { cluster, datasetVersion, question } from '@/db/schema'

// Accept either the root db or an open transaction, so moderation can run this atomically.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executor = typeof db | Tx

/**
 * Assign a question to the nearest cluster (by cosine distance to the cluster's representative
 * question) within its dataset version. Joins if within `cluster_threshold`; otherwise forms a
 * new cluster anchored by this question. Assign-to-nearest only — no re-clustering (spec §8).
 */
export async function assignToNearestCluster(
  questionId: string,
  executor: Executor = db,
): Promise<{ clusterId: string; created: boolean }> {
  const [q] = await executor.select().from(question).where(eq(question.id, questionId)).limit(1)
  if (!q) throw new Error(`Question not found: ${questionId}`)
  if (!q.embedding) throw new Error(`Question has no embedding: ${questionId}`)

  const [dv] = await executor
    .select()
    .from(datasetVersion)
    .where(eq(datasetVersion.id, q.datasetVersionId))
    .limit(1)
  if (!dv) throw new Error(`Dataset version not found: ${q.datasetVersionId}`)

  const rep = alias(question, 'rep')
  const distance = cosineDistance(rep.embedding, q.embedding)
  const [nearest] = await executor
    .select({ clusterId: cluster.id, distance: sql<number>`${distance}` })
    .from(cluster)
    .innerJoin(rep, eq(rep.id, cluster.representativeQuestionId))
    .where(eq(cluster.datasetVersionId, q.datasetVersionId))
    .orderBy(asc(distance))
    .limit(1)

  if (nearest && nearest.distance < dv.clusterThreshold) {
    await executor.update(question).set({ clusterId: nearest.clusterId }).where(eq(question.id, questionId))
    return { clusterId: nearest.clusterId, created: false }
  }

  const [createdCluster] = await executor
    .insert(cluster)
    .values({
      datasetVersionId: q.datasetVersionId,
      representativeQuestionId: questionId,
      thresholdUsed: dv.clusterThreshold,
    })
    .returning()
  await executor.update(question).set({ clusterId: createdCluster.id }).where(eq(question.id, questionId))
  return { clusterId: createdCluster.id, created: true }
}
