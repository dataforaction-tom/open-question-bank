import 'dotenv/config'

// Use the deterministic mock reasoning provider for scoring + synthesis so this seed never
// depends on a live reasoning LLM. (Embeddings still use real Ollama via createQuestion.)
process.env.REASONING_PROVIDER = process.env.REASONING_PROVIDER || 'mock'

import { sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import {
  question,
  cluster,
  moderationEvent,
  refinement,
  definednessScore,
  campaign,
  campaignQuestion,
  comparison,
  score,
  synthesis,
} from '@/db/schema'
import { ensureDefaultWorkspace } from '@/lib/workspace'
import { ensureActiveDatasetVersion } from '@/lib/dataset-version'
import { getModelDigest } from '@/lib/ollama'
import { createQuestion } from '@/lib/submission'
import { approveQuestion } from '@/lib/moderation'
import { promoteToCanonical, scoreQuestion } from '@/lib/curation'
import { recordRefinement } from '@/lib/refinement'
import {
  createCampaign,
  addQuestions,
  openForSubmission,
  openComparison,
  closeCampaign,
} from '@/lib/campaign'
import { recordComparison } from '@/lib/comparison'
import { proposeSyntheses, editSynthesis } from '@/lib/synthesis'

/**
 * Demo seed — wipes the question/campaign pipeline and rebuilds a realistic civic dataset for
 * manual smoke-testing: a searchable bank of canonical questions (some refined), real-feeling
 * campaigns across every public state (open for submission, open for judging, published), and
 * questions promoted into ranking with comparisons and a synthesised agenda.
 *
 * Drives the actual domain functions (embeddings, clustering, TrueSkill, refinement lineage), so
 * every invariant the app enforces also holds here. Keeps `workspace` + `dataset_version`.
 *
 * Run: REASONING_PROVIDER=mock tsx scripts/seed-demo.ts  (mock is the default if unset)
 */

const MODERATOR = 'seed-moderator'
const CURATOR = 'seed-curator'
const MODEL = 'qwen2.5:7b'

type Stage = 'submitted' | 'clustered' | 'canonical'

interface RefineSpec {
  suggested: string
  final: string
  criteria: string[]
  rationale: string
}

interface QuestionSpec {
  text: string
  stage: Stage
  refine?: RefineSpec
  score?: boolean
  visibility?: 'public' | 'anonymous'
}

/**
 * Create a question and walk it to its target stage through the real pipeline.
 * Refinement and scoring only run while `clustered` (the app's ordering rule), before promotion.
 */
async function make(spec: QuestionSpec): Promise<string> {
  const created = await createQuestion({
    rawText: spec.text,
    visibility: spec.visibility ?? 'public',
  })
  const id = created.id
  if (spec.stage === 'submitted') return id

  await approveQuestion(id, MODERATOR) // submitted → clustered (+ assigns a cluster)

  if (spec.refine) {
    await recordRefinement({
      questionId: id,
      action: 'edit',
      before: spec.text,
      llmSuggestedText: spec.refine.suggested,
      finalText: spec.refine.final,
      criteriaApplied: spec.refine.criteria,
      critique: spec.refine.criteria.map((criterion) => ({
        criterion,
        verdict: 'pass' as const,
        note: 'Tightened during curation.',
      })),
      rationale: spec.refine.rationale,
      model: MODEL,
      modelVersion: MODEL,
      actorRef: CURATOR,
    })
  }
  if (spec.score) await scoreQuestion(id)

  if (spec.stage === 'clustered') return id

  await promoteToCanonical(id, CURATOR) // clustered → canonical
  return id
}

// A public judging tool sees many one-off anonymous judges; a unique ref per judgement keeps
// each realistic and satisfies the one-judgement-per-(judge, pair) constraint.
let judgeCounter = 0

/** Record a list of [aIdx, bIdx, winnerIdx | 'draw'] judgements against a campaign. */
async function judge(
  campaignId: string,
  ids: string[],
  results: [number, number, number | 'draw'][],
): Promise<void> {
  for (const [a, b, winner] of results) {
    judgeCounter += 1
    await recordComparison({
      campaignId,
      questionAId: ids[a],
      questionBId: ids[b],
      winnerQuestionId: winner === 'draw' ? null : ids[winner],
      judgeRef: `judge-${String(judgeCounter).padStart(4, '0')}`,
      servedReason: 'seed',
    })
  }
}

/** Full round-robin where the lower index always wins — a clean, confident ranking. */
function roundRobin(n: number): [number, number, number | 'draw'][] {
  const out: [number, number, number | 'draw'][] = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) out.push([i, j, i])
  }
  return out
}

async function main() {
  const ws = await ensureDefaultWorkspace()
  const digest = await getModelDigest(process.env.EMBEDDING_MODEL ?? 'nomic-embed-text')
  await ensureActiveDatasetVersion(
    {
      embeddingModel: process.env.EMBEDDING_MODEL ?? 'nomic-embed-text',
      embeddingModelDigest: digest,
      embeddingDim: Number(process.env.EMBEDDING_DIM ?? '768'),
      dedupThreshold: Number(process.env.DEDUP_THRESHOLD ?? '0.15'),
      clusterThreshold: Number(process.env.CLUSTER_THRESHOLD ?? '0.2'),
    },
    ws.id,
  )

  // Wipe the whole pipeline in one statement (circular question<->cluster FK needs CASCADE).
  // Keeps `workspace` and `dataset_version`.
  console.log('Clearing existing question/campaign data…')
  await db.execute(sql`TRUNCATE TABLE
    ${synthesis}, ${score}, ${comparison}, ${campaignQuestion}, ${campaign},
    ${definednessScore}, ${refinement}, ${moderationEvent}, ${cluster}, ${question}
    RESTART IDENTITY CASCADE`)

  // ---- The searchable bank: canonical questions across civic themes ----------------------------
  console.log('Seeding the canonical question bank…')
  const bank: QuestionSpec[] = [
    {
      text: 'How can we make it safer for children to walk and cycle to school in our neighbourhood?',
      stage: 'canonical',
      score: true,
      refine: {
        suggested:
          'What changes to streets and crossings near schools would make walking and cycling safer for children?',
        final:
          'What specific changes to streets and crossings near our schools would make it safer for children to walk and cycle there?',
        criteria: ['specific', 'scoped'],
        rationale: 'Narrowed to concrete street/crossing changes near schools.',
      },
    },
    {
      text: 'Should new housing developments be required to include genuinely affordable homes?',
      stage: 'canonical',
    },
    {
      text: 'How can our town reach net zero without leaving lower-income households behind?',
      stage: 'canonical',
      score: true,
      refine: {
        suggested:
          'What steps can the town take toward net zero that protect lower-income households from rising costs?',
        final:
          'What practical steps can our town take toward net zero that protect lower-income households from rising costs?',
        criteria: ['specific', 'answerable'],
        rationale: 'Made the trade-off concrete and answerable.',
      },
    },
    {
      text: 'How can we give teenagers safe and welcoming places to spend time after school?',
      stage: 'canonical',
      score: true,
    },
    {
      text: 'How can we reduce loneliness among older people who live alone in our community?',
      stage: 'canonical',
      refine: {
        suggested:
          'What local services or activities would most reduce loneliness for older people living alone?',
        final:
          'Which local services or activities would do most to reduce loneliness among older people living alone?',
        criteria: ['specific', 'single-barrelled'],
        rationale: 'Focused on a single, comparable outcome.',
      },
    },
    {
      text: 'How can we help independent shops survive on our struggling high street?',
      stage: 'canonical',
      score: true,
      refine: {
        suggested:
          'What could the council and residents do over the next year to help independent high-street shops stay open?',
        final:
          'What could the council and residents do over the next year to help independent shops on the high street stay open?',
        criteria: ['specific', 'scoped', 'answerable'],
        rationale: 'Added a timeframe and clear actors.',
      },
    },
    {
      text: 'How do we make sure no one is excluded as council services move online?',
      stage: 'canonical',
    },
    {
      text: 'What would make it easier for unpaid carers to get a break when they need one?',
      stage: 'canonical',
      score: true,
    },
    {
      text: 'How can we make local decision-making more open to people who are usually left out?',
      stage: 'canonical',
    },
    {
      text: 'Should we plant more street trees even if it means losing some parking spaces?',
      stage: 'canonical',
      score: true,
    },
  ]
  for (const spec of bank) await make(spec)

  // ---- A few in-flight questions so the admin queues feel real --------------------------------
  console.log('Seeding in-flight (submitted / clustered) questions…')
  const inflight: QuestionSpec[] = [
    { text: 'Why is it so hard to get a GP appointment in our area?', stage: 'submitted' },
    { text: 'Can we have more frequent buses in the evenings and at weekends?', stage: 'submitted' },
    { text: 'What can be done about the potholes on our residential roads?', stage: 'submitted' },
    { text: 'How can we cut down on litter and fly-tipping in our parks?', stage: 'clustered', score: true },
    { text: 'What would encourage more people to recycle properly at home?', stage: 'clustered' },
  ]
  for (const spec of inflight) await make(spec)

  // ---- Campaign 1: CLOSED, published agenda + synthesis ---------------------------------------
  console.log('Building published campaign: local budget priorities…')
  const budgetIds: string[] = []
  for (const text of [
    'How can we tackle the rising cost of living for families in our area?',
    'What should be done to improve access to affordable mental health support?',
    'How do we keep our libraries and community centres open and thriving?',
    'What would make our streets cleaner and safer to walk at night?',
    'How can we support people struggling to heat their homes in winter?',
  ]) {
    budgetIds.push(await make({ text, stage: 'canonical' }))
  }
  const budget = await createCampaign({
    prompt: "Which community priorities should shape next year's local budget?",
    comparisonAxis: 'importance',
  })
  await addQuestions(budget.id, budgetIds)
  await openComparison(budget.id)
  await judge(budget.id, budgetIds, [
    ...roundRobin(5),
    [4, 0, 4], // a couple of upsets for believable uncertainty
    [3, 1, 3],
    [2, 1, 'draw'],
  ])
  await closeCampaign(budget.id)
  // Propose (mock) then edit to a realistic, endorsed synthesis the public agenda will show.
  const [proposal] = await proposeSyntheses(budget.id)
  if (proposal) {
    await editSynthesis(
      proposal.id,
      'Residents most want next year’s budget to ease the cost of living — keeping homes warm, ' +
        'food and essentials affordable, and frontline mental-health support within reach — while ' +
        'protecting the libraries and community spaces that hold the neighbourhood together.',
      CURATOR,
    )
  }

  // ---- Campaign 2: COMPARING, open for judging ------------------------------------------------
  console.log('Building campaign open for judging: disused railway land…')
  const landIds: string[] = []
  for (const text of [
    'Should the disused land behind the railway station become a community park and growing space?',
    'Could the disused railway land be used for genuinely affordable housing?',
    'Would a covered market on the railway land help local traders?',
    'Should part of the railway land be set aside for young people and sport?',
  ]) {
    landIds.push(await make({ text, stage: 'canonical' }))
  }
  const land = await createCampaign({
    prompt: 'What should we do with the disused land behind the railway station?',
    comparisonAxis: 'community benefit',
  })
  await addQuestions(land.id, landIds)
  await openComparison(land.id)
  // Only a few judgements — leave plenty for the tester to add live.
  await judge(land.id, landIds, [
    [0, 1, 0],
    [2, 3, 2],
    [0, 2, 0],
    [1, 3, 'draw'],
  ])
  // Left in `comparing` (open for judging).

  // ---- Campaign 3: OPEN for submission --------------------------------------------------------
  console.log('Building campaign open for submission: a friendlier neighbourhood…')
  const friendlyIds: string[] = []
  for (const text of [
    'What would help neighbours of different ages and backgrounds get to know each other?',
    'How can we design public spaces so that everyone feels welcome and safe?',
  ]) {
    friendlyIds.push(await make({ text, stage: 'canonical' }))
  }
  const friendly = await createCampaign({
    prompt: 'How can we make our neighbourhood safer and friendlier for everyone?',
    comparisonAxis: 'importance',
  })
  await addQuestions(friendly.id, friendlyIds)
  await openForSubmission(friendly.id)
  // Left in `open` (accepting public submissions).

  // ---- Campaign 4: CLOSED, published (no synthesis yet) ---------------------------------------
  console.log('Building published campaign: where to build cycle routes…')
  const cycleIds: string[] = []
  for (const text of [
    'Which roads feel most dangerous for cycling today and need protected lanes?',
    'How can we better connect the town centre to surrounding villages by bike?',
    'Should new cycle routes be prioritised near schools and colleges?',
    'What would make people who never cycle consider riding for short journeys?',
  ]) {
    cycleIds.push(await make({ text, stage: 'canonical' }))
  }
  const cycle = await createCampaign({
    prompt: 'Where should new cycle routes be built first?',
    comparisonAxis: 'impact',
  })
  await addQuestions(cycle.id, cycleIds)
  await openComparison(cycle.id)
  await judge(cycle.id, cycleIds, [...roundRobin(4), [3, 0, 3]])
  await closeCampaign(cycle.id)

  // ---- Summary --------------------------------------------------------------------------------
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(question)
  const byState = await db
    .select({ state: question.state, n: sql<number>`count(*)::int` })
    .from(question)
    .groupBy(question.state)
    .orderBy(question.state)

  console.log('\n✅ Demo seed complete.')
  console.log(`   Questions: ${total}`)
  for (const row of byState) console.log(`     ${row.state.padEnd(18)} ${row.n}`)
  console.log('   Campaigns: 4 (2 published, 1 judging, 1 open for submission)')
  console.log('\n   Try: /browse · /questions · /campaigns · /admin/dashboard')
  console.log(`   Judge live:   /judge/${land.id}`)
  console.log(`   Submit into:  /campaigns/${friendly.id}/submit`)
  console.log(`   Published:    /campaigns/${budget.id}`)
}

main()
  .then(async () => {
    await pool.end()
  })
  .catch(async (err) => {
    console.error(err)
    await pool.end()
    process.exit(1)
  })
