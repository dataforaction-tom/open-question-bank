import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { campaign, question, score, synthesis, type Synthesis } from '@/db/schema'
import { IneligibleError, NotFoundError } from '@/lib/errors'
import { getProvider, type RankedQuestion, type ReasoningProvider } from '@/lib/llm'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Filter LLM-proposed source ids to real campaign members, deduped, order-preserving. Pure. */
export function validateSources(sourceIds: string[], memberIds: Set<string>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of sourceIds) {
    if (memberIds.has(id) && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

async function requireClosed(campaignId: string) {
  const [c] = await db.select().from(campaign).where(eq(campaign.id, campaignId)).limit(1)
  if (!c) throw new NotFoundError(`Campaign not found: ${campaignId}`)
  if (c.state !== 'closed') throw new IneligibleError(`Campaign ${campaignId} is not closed (state=${c.state})`)
  return c
}

async function requireProposed(synthesisId: string): Promise<Synthesis> {
  const [row] = await db.select().from(synthesis).where(eq(synthesis.id, synthesisId)).limit(1)
  if (!row) throw new NotFoundError(`Synthesis not found: ${synthesisId}`)
  if (row.status !== 'proposed') throw new IneligibleError(`Synthesis ${synthesisId} is not actionable (status=${row.status})`)
  return row
}

/** LLM proposes syntheses over the closed campaign's ranked set. Repeatable; appends rows. */
export async function proposeSyntheses(
  campaignId: string,
  provider: Pick<ReasoningProvider, 'synthesise'> = getProvider(),
): Promise<Synthesis[]> {
  await requireClosed(campaignId)
  const ranked: RankedQuestion[] = await db
    .select({ id: score.questionId, canonicalText: question.canonicalText })
    .from(score)
    .innerJoin(question, eq(score.questionId, question.id))
    .where(eq(score.campaignId, campaignId))
    .orderBy(desc(score.mu))
  const memberIds = new Set(ranked.map((r) => r.id))

  const result = await provider.synthesise(ranked)
  const values = result.proposals
    .map((p) => ({ ...p, sourceQuestionIds: validateSources(p.sourceQuestionIds, memberIds) }))
    .filter((p) => p.sourceQuestionIds.length > 0)
    .map((p) => ({
      campaignId,
      synthesisedText: p.synthesisedText,
      sourceQuestionIds: p.sourceQuestionIds,
      rationale: p.rationale,
      proposedBy: 'llm' as const,
      model: result.model,
      modelVersion: result.modelVersion,
    }))
  if (values.length === 0) return []
  return db.insert(synthesis).values(values).returning()
}

/** All synthesis rows for a campaign (admin audit), newest first. */
export async function listSyntheses(campaignId: string): Promise<Synthesis[]> {
  return db.select().from(synthesis).where(eq(synthesis.campaignId, campaignId)).orderBy(desc(synthesis.timestamp))
}

export async function endorseSynthesis(synthesisId: string, actorRef: string): Promise<Synthesis> {
  const row = await requireProposed(synthesisId)
  if (row.endorsedBy.includes(actorRef)) return row // already endorsed — idempotent, no write
  // Append atomically in SQL so concurrent endorsements can't lose each other's writes;
  // the WHERE guard keeps it idempotent without an application-level read-modify-write race.
  const [updated] = await db
    .update(synthesis)
    .set({ endorsedBy: sql`array_append(${synthesis.endorsedBy}, ${actorRef})` })
    .where(and(eq(synthesis.id, synthesisId), sql`NOT (${actorRef} = ANY(${synthesis.endorsedBy}))`))
    .returning()
  return updated ?? row // WHERE matched nothing → a concurrent txn already added this actor
}

export async function editSynthesis(synthesisId: string, newText: string, actorRef: string): Promise<Synthesis> {
  return db.transaction(async (tx: Tx) => {
    // Re-read + guard INSIDE the tx (no TOCTOU): a concurrent reject/edit can't slip
    // between the status check and the supersede — FOR UPDATE locks the row so a
    // concurrent edit/reject blocks, then re-reads the now-superseded status and bails.
    const [row] = await tx.select().from(synthesis).where(eq(synthesis.id, synthesisId)).limit(1).for('update')
    if (!row) throw new NotFoundError(`Synthesis not found: ${synthesisId}`)
    if (row.status !== 'proposed') {
      throw new IneligibleError(`Synthesis ${synthesisId} is not actionable (status=${row.status})`)
    }
    await tx.update(synthesis).set({ status: 'superseded' }).where(eq(synthesis.id, synthesisId))
    const [created] = await tx
      .insert(synthesis)
      .values({
        campaignId: row.campaignId,
        synthesisedText: newText,
        sourceQuestionIds: row.sourceQuestionIds,
        rationale: row.rationale,
        version: row.version + 1,
        supersedesId: row.id,
        proposedBy: 'human',
        endorsedBy: [actorRef],
      })
      .returning()
    return created
  })
}

export async function rejectSynthesis(synthesisId: string, actorRef: string): Promise<Synthesis> {
  await requireProposed(synthesisId)
  void actorRef // reserved for a future per-action audit row (spec §11)
  const [updated] = await db
    .update(synthesis)
    .set({ status: 'rejected' })
    .where(eq(synthesis.id, synthesisId))
    .returning()
  return updated
}

export interface EndorsedSynthesis {
  synthesisedText: string
  rationale: string
  sources: { questionId: string; canonicalText: string }[]
}

/** Public: endorsed-and-live syntheses for a CLOSED campaign, with resolved lineage. */
export async function listEndorsedSyntheses(campaignId: string): Promise<EndorsedSynthesis[]> {
  await requireClosed(campaignId)
  const rows = await db
    .select({
      synthesisedText: synthesis.synthesisedText,
      rationale: synthesis.rationale,
      sourceQuestionIds: synthesis.sourceQuestionIds,
    })
    .from(synthesis)
    .where(
      and(
        eq(synthesis.campaignId, campaignId),
        eq(synthesis.status, 'proposed'),
        // array_length returns NULL for '{}', so `>= 1` is the correct non-empty (endorsed) guard.
        sql`array_length(${synthesis.endorsedBy}, 1) >= 1`,
      ),
    )
    .orderBy(desc(synthesis.timestamp))

  const allIds = [...new Set(rows.flatMap((r) => r.sourceQuestionIds))]
  const texts = allIds.length
    ? await db
        .select({ id: question.id, canonicalText: question.canonicalText })
        .from(question)
        .where(inArray(question.id, allIds))
    : []
  const byId = new Map(texts.map((t) => [t.id, t.canonicalText]))

  return rows.map((r) => ({
    synthesisedText: r.synthesisedText,
    rationale: r.rationale,
    // source_question_ids is a plain uuid[] (no per-element FK); '' is the fallback if a
    // source question ever went missing — in practice questions are never deleted.
    sources: r.sourceQuestionIds.map((qid) => ({ questionId: qid, canonicalText: byId.get(qid) ?? '' })),
  }))
}
