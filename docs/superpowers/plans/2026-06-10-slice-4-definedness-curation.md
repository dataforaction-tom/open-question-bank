# Slice 4 — Definedness Scoring + Canonical Curation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Model-produced 1–5 definedness scores (five criteria, append-only, advisory) plus the audited `clustered → canonical` promotion, behind a new `/admin/curation` page.

**Architecture:** Migration `0003` adds the append-only `definedness_score` table and a `promote` value on `moderation_action`. The Slice 3 provider's retry/validate/version loop is extracted into a generic `complete(prompt, schema)` shared by `refine()` and the new `score()`. A new `src/lib/curation.ts` orchestrates scoring (persist 5 rows atomically) and promotion (state flip + audit row in one transaction); three admin routes and one admin page sit on top.

**Tech Stack:** Next.js 15 (App Router), Drizzle ORM + drizzle-kit, Postgres/pgvector (docker, dbs `qb` + `qb_test`), zod 4, Vitest, Playwright (mock provider).

**Spec:** `docs/superpowers/specs/2026-06-10-slice-4-definedness-curation-design.md` (approved). Branch: `feat/slice-4-definedness-curation` (already created, spec committed).

**Conventions you must follow** (from the existing codebase):
- Conventional Commits, subject ≤72 chars, **no AI/Claude attribution anywhere**.
- Routes map errors: `NotFoundError` → 404, `IneligibleError` → 409, provider failure → 502, unexpected → 500 with `console.error('[METHOD path]', err)`.
- Integration tests run against `qb_test` (the vitest setup file redirects `DATABASE_URL` → `TEST_DATABASE_URL`); they TRUNCATE tables in `beforeEach` and `await pool.end()` in `afterAll`.
- Verify commands: `npm test`, `npm run lint` (eslint src/ — NOT next lint), `npx tsc --noEmit`, `npm run test:e2e` (Playwright starts its own server on port 3100 with `REASONING_PROVIDER=mock`).
- Do NOT touch the running docker services or ports 3000/5432/11434.

---

### Task 1: Schema + migration 0003

**Files:**
- Modify: `src/db/schema.ts`
- Generated: `drizzle/0003_*.sql` (via drizzle-kit)

- [ ] **Step 1: Add the enum value, new enum, and table to `src/db/schema.ts`**

Add `'promote'` to the existing `moderationActionEnum` (line 36):

```ts
export const moderationActionEnum = pgEnum('moderation_action', ['approve', 'reject', 'promote'])
```

Add `check` to the existing `drizzle-orm/pg-core` import list, then add below the `refinement` table:

```ts
// The five definedness criteria (mirrors definedness-rubric.md and CRITERIA in src/lib/llm.ts).
export const definednessCriterionEnum = pgEnum('definedness_criterion', [
  'specific',
  'answerable',
  'scoped',
  'non-leading',
  'single-barrelled',
])

// Append-only model assessment at curation time (spec §4). One scoring run inserts five rows
// (one per criterion) in a single statement, so they share an identical now() timestamp —
// that shared timestamp is how runs are grouped. Rows are never mutated; re-scoring appends.
// model/model_version are NOT NULL: scores are always model-produced (no human path).
export const definednessScore = pgTable(
  'definedness_score',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => question.id),
    criterion: definednessCriterionEnum('criterion').notNull(),
    score: integer('score').notNull(),
    rationale: text('rationale').notNull(),
    model: text('model').notNull(),
    modelVersion: text('model_version').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('definedness_score_question_idx').on(table.questionId),
    // Belt-and-braces under the zod boundary validation (design §3).
    check('definedness_score_range', sql`${table.score} BETWEEN 1 AND 5`),
  ],
)
```

And at the bottom with the other type exports:

```ts
export type DefinednessScore = typeof definednessScore.$inferSelect
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0003_<codename>.sql` containing (a) `ALTER TYPE "public"."moderation_action" ADD VALUE 'promote'`, (b) `CREATE TYPE "public"."definedness_criterion"`, (c) `CREATE TABLE "definedness_score"` with the FK, the btree index, and `CONSTRAINT "definedness_score_range" CHECK`. **Read the generated SQL and verify all three.** If drizzle-kit instead tries to drop/recreate `moderation_action`, stop and hand-edit the migration to a plain `ALTER TYPE ... ADD VALUE` (keeping the statement-breakpoint format) — do not let it rewrite the enum destructively.

- [ ] **Step 3: Apply to both databases**

```bash
npm run db:migrate
DATABASE_URL=postgres://qb:qb@localhost:5432/qb_test npm run db:migrate
```

Expected: both complete without error. (Optional check: `docker compose exec db psql -U qb -d qb_test -c '\d definedness_score'`.)

- [ ] **Step 4: Verify nothing broke**

Run: `npm test && npx tsc --noEmit`
Expected: all 45 tests pass; clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat: add definedness_score table and promote audit action"
```

---

### Task 2: Provider refactor — `ReasoningProvider` rename + generic `complete()`

Behaviour-preserving: **all existing tests must pass with no assertion changes** (type/rename edits only).

**Files:**
- Modify: `src/lib/llm.ts`
- Modify: `src/lib/refinement.ts` (imports + provider param types)
- Modify: `tests/integration/refinement.test.ts` (stub type only)

- [ ] **Step 1: Extract `complete()` in `src/lib/llm.ts`**

Rename the interface and narrow nothing else:

```ts
export interface ReasoningProvider {
  refine(canonicalText: string): Promise<RefinementSuggestion>
}
```

(The `score()` method is added in Task 3 — adding it now would break `MockProvider` and the test stubs mid-task.)

Replace `ChatProvider`'s `refine()` body with the extracted generic plus a thin wrapper. `ChatProvider` now `implements ReasoningProvider`:

```ts
/** Shared chat-provider logic: call, zod-validate, retry once, resolve model_version. */
abstract class ChatProvider implements ReasoningProvider {
  constructor(protected readonly model: string) {}

  protected abstract callChat(prompt: string): Promise<unknown>
  protected abstract resolveModelVersion(): Promise<string>

  /**
   * One validated structured completion. Retries once, but ONLY on a transport or
   * output-validation failure. Provenance resolution stays outside the loop so a digest
   * hiccup can't trigger a wasteful second LLM call.
   */
  protected async complete<T>(
    prompt: string,
    schema: z.ZodType<T>,
  ): Promise<T & { model: string; modelVersion: string }> {
    let parsed: T | undefined
    let lastErr: unknown
    for (let attempt = 0; attempt < 2 && parsed === undefined; attempt++) {
      try {
        parsed = schema.parse(await this.callChat(prompt))
      } catch (err) {
        lastErr = err
      }
    }
    if (parsed === undefined) {
      const message = lastErr instanceof Error ? lastErr.message : String(lastErr)
      throw new ProviderError(`Reasoning call failed: ${message}`)
    }
    const modelVersion = await this.resolveModelVersion() // never throws — falls back to the model id
    return { ...parsed, model: this.model, modelVersion }
  }

  async refine(canonicalText: string): Promise<RefinementSuggestion> {
    return this.complete(buildRefinementPrompt(canonicalText), refinementSuggestionSchema)
  }
}
```

Update `MockProvider implements ReasoningProvider` and `getProvider(): ReasoningProvider` (bodies unchanged). Delete the old `RefinementProvider` name entirely — no alias.

- [ ] **Step 2: Update consumers to the narrow capability they need**

In `src/lib/refinement.ts`, change the import and the provider param to a `Pick`, so Task 3's interface growth can't break refine-only stubs:

```ts
import { getProvider, type ReasoningProvider, type RefinementSuggestion } from '@/lib/llm'
```

```ts
export async function suggestRefinement(
  questionId: string,
  provider: Pick<ReasoningProvider, 'refine'> = getProvider(),
): Promise<{ before: string; suggestion: RefinementSuggestion }> {
```

In `tests/integration/refinement.test.ts`, update the two type references:

```ts
import type { ReasoningProvider, RefinementSuggestion } from '@/lib/llm'
```

```ts
const stubProvider: Pick<ReasoningProvider, 'refine'> = { refine: async () => SUGGESTION }
```

- [ ] **Step 3: Verify everything still passes**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all 45 tests pass (proves `refine()` behaviour is preserved); clean typecheck and lint. `grep -rn "RefinementProvider" src/ tests/` returns nothing.

- [ ] **Step 4: Commit**

```bash
git add src/lib/llm.ts src/lib/refinement.ts tests/integration/refinement.test.ts
git commit -m "refactor: extract generic complete() core from refine provider"
```

---

### Task 3: Scoring contract, prompt, `score()`, and mock

**Files:**
- Modify: `src/lib/llm.ts`
- Test: `tests/unit/llm.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/llm.test.ts` (the `chatResponse` helper and `afterEach` reset already exist in this file):

```ts
const VALID_SCORES = {
  scores: [
    { criterion: 'specific', score: 4, rationale: 'concrete ask' },
    { criterion: 'answerable', score: 5, rationale: 'evidence could settle it' },
    { criterion: 'scoped', score: 2, rationale: 'no timeframe or population' },
    { criterion: 'non-leading', score: 5, rationale: 'neutral framing' },
    { criterion: 'single-barrelled', score: 3, rationale: 'borderline second clause' },
  ],
}

describe('buildScoringPrompt', () => {
  it('embeds all five criteria, the 1–5 anchors, and the question text', () => {
    const prompt = buildScoringPrompt('How do we fix education?')
    for (const c of ['specific', 'answerable', 'scoped', 'non-leading', 'single-barrelled']) {
      expect(prompt).toContain(c)
    }
    expect(prompt).toContain('1 = clearly fails')
    expect(prompt).toContain('5 = clearly satisfies')
    expect(prompt).toContain('How do we fix education?')
  })
})

describe('scoreResultSchema', () => {
  it('accepts a well-formed result', () => {
    expect(() => scoreResultSchema.parse(VALID_SCORES)).not.toThrow()
  })
  it('rejects a missing criterion (only four entries)', () => {
    expect(() => scoreResultSchema.parse({ scores: VALID_SCORES.scores.slice(0, 4) })).toThrow()
  })
  it('rejects a duplicated criterion', () => {
    const dup = { scores: [...VALID_SCORES.scores.slice(0, 4), VALID_SCORES.scores[0]] }
    expect(() => scoreResultSchema.parse(dup)).toThrow()
  })
  it('rejects an out-of-range score', () => {
    const bad = { scores: VALID_SCORES.scores.map((s, i) => (i === 0 ? { ...s, score: 6 } : s)) }
    expect(() => scoreResultSchema.parse(bad)).toThrow()
  })
  it('rejects a non-integer score', () => {
    const bad = { scores: VALID_SCORES.scores.map((s, i) => (i === 0 ? { ...s, score: 3.5 } : s)) }
    expect(() => scoreResultSchema.parse(bad)).toThrow()
  })
})

describe('ChatProvider.score', () => {
  it('returns a validated result with provenance', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(chatResponse(VALID_SCORES))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ models: [{ name: 'qwen2.5:7b', digest: 'sha256:abc' }] }), {
          status: 200,
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const provider = new OllamaChatProvider({ baseUrl: 'http://localhost:11434', model: 'qwen2.5:7b' })
    const result = await provider.score('How do we fix education?')

    expect(result.scores).toHaveLength(5)
    expect(result.model).toBe('qwen2.5:7b')
    expect(result.modelVersion).toBe('sha256:abc')
  })

  it('retries once then throws ProviderError on an invalid payload', async () => {
    // Valid JSON transport-wise, but fails the contract (missing criteria).
    const fetchMock = vi.fn().mockResolvedValue(chatResponse({ scores: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new OllamaChatProvider({ baseUrl: 'http://localhost:11434', model: 'qwen2.5:7b' })
    await expect(provider.score('x')).rejects.toBeInstanceOf(ProviderError)
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/api/chat'))).toHaveLength(2)
  })
})

describe('MockProvider.score', () => {
  it('is deterministic: all five criteria, fixed scores and rationales', async () => {
    const a = await new MockProvider().score('anything')
    const b = await new MockProvider().score('anything else')
    expect(a).toEqual(b)
    expect(a.scores).toHaveLength(5)
    expect(a.scores[0]).toEqual({ criterion: 'specific', score: 4, rationale: 'mock specific rationale' })
    expect(a.model).toBe('mock')
  })
})
```

Extend the file's import from `@/lib/llm` with: `buildScoringPrompt`, `scoreResultSchema`, `MockProvider`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/llm.test.ts`
Expected: FAIL — `buildScoringPrompt`, `scoreResultSchema` not exported.

- [ ] **Step 3: Implement in `src/lib/llm.ts`**

Add after `refinementSuggestionSchema`:

```ts
const criterionScoreSchema = z.object({
  criterion: z.enum(CRITERIA),
  score: z.number().int().min(1).max(5),
  rationale: z.string().min(1),
})

/** Exactly five entries, each criterion present exactly once. */
export const scoreResultSchema = z
  .object({ scores: z.array(criterionScoreSchema).length(CRITERIA.length) })
  .refine((r) => new Set(r.scores.map((s) => s.criterion)).size === CRITERIA.length, {
    message: 'each criterion must appear exactly once',
  })

export type ScoreResult = z.infer<typeof scoreResultSchema> & {
  model: string
  modelVersion: string
}
```

Add `score` to the interface:

```ts
export interface ReasoningProvider {
  refine(canonicalText: string): Promise<RefinementSuggestion>
  score(canonicalText: string): Promise<ScoreResult>
}
```

Add the scoring prompt builder near `buildRefinementPrompt`. Scoring gets the *full* rubric — definition plus fails-when guidance per criterion (richer than the condensed `RUBRIC` block refinement uses), with explicit anchors:

```ts
/** Fuller rubric for scoring: definition + fails-when guidance (mirrors definedness-rubric.md). */
const SCORING_RUBRIC = `A well-defined question satisfies five independent criteria:
- specific (concreteness vs vagueness): concrete enough to act on. Fails when too general or abstract to yield a meaningful answer.
- answerable (can it be answered at all): evidence, reasoning, or investigation could in principle settle it. Fails when unfalsifiable, rhetorical, or no conceivable evidence would resolve it.
- scoped (bounded extent): clear boundaries — domain, population, timeframe, or context. Fails when boundless, with no clear who / where / when.
- non-leading (neutrality): does not presuppose its own answer or embed bias. Fails when it smuggles in a conclusion or loads the framing.
- single-barrelled (one ask): asks about exactly one thing. Fails when two or more distinct questions are bundled under one answer.`

export function buildScoringPrompt(canonicalText: string): string {
  return `You assess how well-defined a question is against a definedness rubric.

${SCORING_RUBRIC}

Score each criterion independently on an integer scale from 1 to 5:
1 = clearly fails the criterion, 3 = partially satisfies it, 5 = clearly satisfies it.

Question to score:
"""${canonicalText}"""

Return ONLY a JSON object with this exact shape:
{
  "scores": [
    { "criterion": <one of the five>, "score": <integer 1-5>, "rationale": "short reason for this score" },
    ... exactly one entry per criterion, all five criteria present ...
  ]
}`
}
```

Add the wrapper to `ChatProvider` (next to `refine`):

```ts
  async score(canonicalText: string): Promise<ScoreResult> {
    return this.complete(buildScoringPrompt(canonicalText), scoreResultSchema)
  }
```

Add to `MockProvider`:

```ts
  async score(): Promise<ScoreResult> {
    return {
      scores: CRITERIA.map((criterion) => ({
        criterion,
        score: 4,
        rationale: `mock ${criterion} rationale`,
      })),
      model: 'mock',
      modelVersion: 'mock',
    }
  }
```

- [ ] **Step 4: Run all tests**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: PASS (45 existing + the new unit tests). The `Pick` from Task 2 keeps the refine-only stub compiling.

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm.ts tests/unit/llm.test.ts
git commit -m "feat: add definedness score() to the reasoning provider"
```

---

### Task 4: Shared errors + curation lib

**Files:**
- Create: `src/lib/errors.ts`
- Create: `src/lib/curation.ts`
- Modify: `src/lib/refinement.ts` (errors moved out, re-exported)
- Test: `tests/integration/curation.test.ts`

- [ ] **Step 1: Move the typed errors to `src/lib/errors.ts`**

```ts
/** Shared typed errors — routes map NotFoundError → 404, IneligibleError → 409. */
export class NotFoundError extends Error {}
export class IneligibleError extends Error {}
```

In `src/lib/refinement.ts`, delete the two class definitions and replace with:

```ts
import { IneligibleError, NotFoundError } from '@/lib/errors'

// Re-exported so existing imports (routes, tests) keep working.
export { IneligibleError, NotFoundError }
```

Run: `npm test` — all green (pure move).

- [ ] **Step 2: Write the failing integration tests**

Create `tests/integration/curation.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { datasetVersion, definednessScore, moderationEvent, question } from '@/db/schema'
import type { ReasoningProvider, ScoreResult } from '@/lib/llm'
import { ProviderError } from '@/lib/llm'
import { IneligibleError, NotFoundError } from '@/lib/errors'
import { currentScores, listScores, promoteToCanonical, scoreQuestion } from '@/lib/curation'

let versionId: number

function pad(vec: number[]): number[] {
  return [...vec, ...Array(768 - vec.length).fill(0)]
}

async function insert(text: string, state: 'submitted' | 'clustered' | 'canonical'): Promise<string> {
  const [row] = await db
    .insert(question)
    .values({
      rawText: text,
      canonicalText: text,
      embedding: pad([1, 0, 0]),
      embeddingModelVersion: 'test@sha256:test',
      datasetVersionId: versionId,
      visibility: 'public',
      state,
    })
    .returning()
  return row.id
}

function stubResult(score: number, modelVersion = 'sha256:abc'): ScoreResult {
  return {
    scores: (['specific', 'answerable', 'scoped', 'non-leading', 'single-barrelled'] as const).map(
      (criterion) => ({ criterion, score, rationale: `because ${criterion}` }),
    ),
    model: 'qwen2.5:7b',
    modelVersion,
  }
}

function stubProvider(score: number, modelVersion?: string): Pick<ReasoningProvider, 'score'> {
  return { score: async () => stubResult(score, modelVersion) }
}

const failingProvider: Pick<ReasoningProvider, 'score'> = {
  score: async () => {
    throw new ProviderError('model unavailable')
  },
}

const MISSING_ID = '00000000-0000-0000-0000-000000000000'

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ${definednessScore} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${moderationEvent} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${question} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${datasetVersion} RESTART IDENTITY CASCADE`)
  const [v] = await db
    .insert(datasetVersion)
    .values({ embeddingModel: 'test', embeddingModelDigest: 'sha256:test', embeddingDim: 768 })
    .returning()
  versionId = v.id
})
afterAll(async () => {
  await pool.end()
})

describe('scoreQuestion', () => {
  it('persists five rows with shared timestamp and provenance', async () => {
    const id = await insert('How do we fix education?', 'clustered')
    const rows = await scoreQuestion(id, stubProvider(4))
    expect(rows).toHaveLength(5)
    expect(new Set(rows.map((r) => r.criterion)).size).toBe(5)
    expect(new Set(rows.map((r) => r.timestamp.getTime())).size).toBe(1) // one run, one timestamp
    expect(rows.every((r) => r.model === 'qwen2.5:7b' && r.modelVersion === 'sha256:abc')).toBe(true)
  })

  it('does not change question state (advisory)', async () => {
    const id = await insert('How do we fix education?', 'clustered')
    await scoreQuestion(id, stubProvider(4))
    const [q] = await db.select().from(question).where(eq(question.id, id))
    expect(q.state).toBe('clustered')
  })

  it('throws IneligibleError for a non-clustered question', async () => {
    const id = await insert('pending', 'submitted')
    await expect(scoreQuestion(id, stubProvider(4))).rejects.toBeInstanceOf(IneligibleError)
  })

  it('throws NotFoundError for a missing question', async () => {
    await expect(scoreQuestion(MISSING_ID, stubProvider(4))).rejects.toBeInstanceOf(NotFoundError)
  })

  it('writes nothing when the provider fails', async () => {
    const id = await insert('How do we fix education?', 'clustered')
    await expect(scoreQuestion(id, failingProvider)).rejects.toBeInstanceOf(ProviderError)
    const rows = await db.select().from(definednessScore)
    expect(rows).toHaveLength(0)
  })
})

describe('listScores + currentScores', () => {
  it('throws NotFoundError for a missing question (stricter than listRefinements)', async () => {
    await expect(listScores(MISSING_ID)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('returns [] for a question never scored', async () => {
    const id = await insert('unscored', 'clustered')
    expect(await listScores(id)).toEqual([])
  })

  it('current view is the latest row per criterion after a re-score', async () => {
    const id = await insert('How do we fix education?', 'clustered')
    await scoreQuestion(id, stubProvider(2, 'sha256:old'))
    await scoreQuestion(id, stubProvider(5, 'sha256:new'))
    const history = await listScores(id)
    expect(history).toHaveLength(10) // append-only: both runs kept
    const current = currentScores(history)
    expect(current).toHaveLength(5)
    expect(current.every((r) => r.score === 5 && r.modelVersion === 'sha256:new')).toBe(true)
  })
})

describe('promoteToCanonical', () => {
  it('flips state and appends a promote audit row in one transaction', async () => {
    const id = await insert('Well defined question?', 'clustered')
    const updated = await promoteToCanonical(id, 'admin')
    expect(updated.state).toBe('canonical')
    const events = await db.select().from(moderationEvent).where(eq(moderationEvent.questionId, id))
    expect(events).toHaveLength(1)
    expect(events[0].action).toBe('promote')
    expect(events[0].actorRef).toBe('admin')
  })

  it('works with zero scores on record (scoring is advisory, never a gate)', async () => {
    const id = await insert('never scored', 'clustered')
    const updated = await promoteToCanonical(id, 'admin')
    expect(updated.state).toBe('canonical')
  })

  it('rejects a second promote (no double audit rows)', async () => {
    const id = await insert('once only', 'clustered')
    await promoteToCanonical(id, 'admin')
    await expect(promoteToCanonical(id, 'admin')).rejects.toBeInstanceOf(IneligibleError)
    const events = await db.select().from(moderationEvent).where(eq(moderationEvent.questionId, id))
    expect(events).toHaveLength(1)
  })

  it('throws NotFoundError for a missing question', async () => {
    await expect(promoteToCanonical(MISSING_ID, 'admin')).rejects.toBeInstanceOf(NotFoundError)
  })
})
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/integration/curation.test.ts`
Expected: FAIL — `@/lib/curation` does not exist.

- [ ] **Step 4: Implement `src/lib/curation.ts`**

```ts
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { definednessScore, moderationEvent, question, type DefinednessScore, type Question } from '@/db/schema'
import { IneligibleError, NotFoundError } from '@/lib/errors'
import { getProvider, type ReasoningProvider } from '@/lib/llm'

/**
 * Run the reasoning LLM's definedness assessment and persist five append-only rows
 * (one per criterion). One INSERT statement = atomic, and all rows share the same
 * now() timestamp — that shared timestamp is how the UI groups scoring runs.
 * Advisory only: never touches state, repeatable at will (spec §4; design §3).
 */
export async function scoreQuestion(
  questionId: string,
  provider: Pick<ReasoningProvider, 'score'> = getProvider(),
): Promise<DefinednessScore[]> {
  const [q] = await db.select().from(question).where(eq(question.id, questionId)).limit(1)
  if (!q) throw new NotFoundError(`Question not found: ${questionId}`)
  if (q.state !== 'clustered') throw new IneligibleError(`Question ${questionId} is not clustered (state=${q.state})`)

  const result = await provider.score(q.canonicalText)
  return db
    .insert(definednessScore)
    .values(
      result.scores.map((s) => ({
        questionId,
        criterion: s.criterion,
        score: s.score,
        rationale: s.rationale,
        model: result.model,
        modelVersion: result.modelVersion,
      })),
    )
    .returning()
}

/** Full score history, oldest first. 404s on an unknown question (no silent empty list). */
export async function listScores(questionId: string): Promise<DefinednessScore[]> {
  const [q] = await db.select({ id: question.id }).from(question).where(eq(question.id, questionId)).limit(1)
  if (!q) throw new NotFoundError(`Question not found: ${questionId}`)
  return db
    .select()
    .from(definednessScore)
    .where(eq(definednessScore.questionId, questionId))
    .orderBy(asc(definednessScore.timestamp))
}

/** Latest row per criterion — the derived "current" view over the append-only history. */
export function currentScores(history: DefinednessScore[]): DefinednessScore[] {
  const latest = new Map<string, DefinednessScore>()
  for (const row of history) latest.set(row.criterion, row) // oldest-first input: later rows win
  return [...latest.values()]
}

/**
 * clustered → canonical (spec §5), audited. The state guard runs inside the transaction,
 * so concurrent promotes cannot double-append audit rows. No scoring precondition —
 * the human stays in control (design §3).
 */
export async function promoteToCanonical(questionId: string, actorRef: string): Promise<Question> {
  return db.transaction(async (tx) => {
    const [q] = await tx.select().from(question).where(eq(question.id, questionId)).limit(1)
    if (!q) throw new NotFoundError(`Question not found: ${questionId}`)
    if (q.state !== 'clustered') throw new IneligibleError(`Question ${questionId} is not clustered (state=${q.state})`)

    await tx.insert(moderationEvent).values({ questionId, action: 'promote', actorRef })
    const [updated] = await tx
      .update(question)
      .set({ state: 'canonical' })
      .where(eq(question.id, questionId))
      .returning()
    return updated
  })
}
```

- [ ] **Step 5: Run all tests**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/errors.ts src/lib/curation.ts src/lib/refinement.ts tests/integration/curation.test.ts
git commit -m "feat: add curation lib (score, list, promote) with shared errors"
```

---

### Task 5: API routes — score, scores, promote

**Files:**
- Create: `src/app/api/admin/questions/[id]/score/route.ts`
- Create: `src/app/api/admin/questions/[id]/scores/route.ts`
- Create: `src/app/api/admin/questions/[id]/promote/route.ts`
- Test: `tests/integration/curation-routes.test.ts`

All three sit under the existing `/api/admin` middleware guard (no route-level auth code needed; the middleware is already covered by `tests/unit/admin-auth.test.ts` and the e2e suite).

- [ ] **Step 1: Write the failing route tests**

Create `tests/integration/curation-routes.test.ts`. Route handlers are imported directly and called with a stub `params` promise — `REASONING_PROVIDER=mock` makes the score route deterministic; stubbing `fetch` to reject under `REASONING_PROVIDER=ollama` forces the 502 path without any timeout wait:

```ts
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { datasetVersion, definednessScore, moderationEvent, question } from '@/db/schema'
import { POST as scorePost } from '@/app/api/admin/questions/[id]/score/route'
import { GET as scoresGet } from '@/app/api/admin/questions/[id]/scores/route'
import { POST as promotePost } from '@/app/api/admin/questions/[id]/promote/route'

let versionId: number

function pad(vec: number[]): number[] {
  return [...vec, ...Array(768 - vec.length).fill(0)]
}

async function insert(text: string, state: 'submitted' | 'clustered'): Promise<string> {
  const [row] = await db
    .insert(question)
    .values({
      rawText: text,
      canonicalText: text,
      embedding: pad([1, 0, 0]),
      embeddingModelVersion: 'test@sha256:test',
      datasetVersionId: versionId,
      visibility: 'public',
      state,
    })
    .returning()
  return row.id
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) }
}

const REQ = new Request('http://localhost/test')
const MISSING_ID = '00000000-0000-0000-0000-000000000000'

beforeEach(async () => {
  vi.stubEnv('REASONING_PROVIDER', 'mock')
  await db.execute(sql`TRUNCATE TABLE ${definednessScore} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${moderationEvent} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${question} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${datasetVersion} RESTART IDENTITY CASCADE`)
  const [v] = await db
    .insert(datasetVersion)
    .values({ embeddingModel: 'test', embeddingModelDigest: 'sha256:test', embeddingDim: 768 })
    .returning()
  versionId = v.id
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
afterAll(async () => {
  await pool.end()
})

describe('POST /api/admin/questions/[id]/score', () => {
  it('200: persists and returns the five mock rows', async () => {
    const id = await insert('How do we fix education?', 'clustered')
    const res = await scorePost(REQ, ctx(id))
    expect(res.status).toBe(200)
    const { scores } = await res.json()
    expect(scores).toHaveLength(5)
    expect(scores[0].model).toBe('mock')
  })

  it('404 for a missing question', async () => {
    expect((await scorePost(REQ, ctx(MISSING_ID))).status).toBe(404)
  })

  it('409 for a non-clustered question', async () => {
    const id = await insert('pending', 'submitted')
    expect((await scorePost(REQ, ctx(id))).status).toBe(409)
  })

  it('502 when the provider is unreachable, and writes nothing', async () => {
    vi.stubEnv('REASONING_PROVIDER', 'ollama')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')))
    const id = await insert('How do we fix education?', 'clustered')
    expect((await scorePost(REQ, ctx(id))).status).toBe(502)
    expect(await db.select().from(definednessScore)).toHaveLength(0)
  })
})

describe('GET /api/admin/questions/[id]/scores', () => {
  it('200: returns current (latest per criterion) and full history', async () => {
    const id = await insert('How do we fix education?', 'clustered')
    await scorePost(REQ, ctx(id))
    await scorePost(REQ, ctx(id)) // re-score appends
    const res = await scoresGet(REQ, ctx(id))
    expect(res.status).toBe(200)
    const { current, history } = await res.json()
    expect(current).toHaveLength(5)
    expect(history).toHaveLength(10)
  })

  it('404 for a missing question (not 200 + empty)', async () => {
    expect((await scoresGet(REQ, ctx(MISSING_ID))).status).toBe(404)
  })
})

describe('POST /api/admin/questions/[id]/promote', () => {
  it('200: promotes and returns the canonical question', async () => {
    const id = await insert('Well defined?', 'clustered')
    const res = await promotePost(REQ, ctx(id))
    expect(res.status).toBe(200)
    const { question: updated } = await res.json()
    expect(updated.state).toBe('canonical')
  })

  it('404 for a missing question', async () => {
    expect((await promotePost(REQ, ctx(MISSING_ID))).status).toBe(404)
  })

  it('409 for a re-promote', async () => {
    const id = await insert('once', 'clustered')
    await promotePost(REQ, ctx(id))
    expect((await promotePost(REQ, ctx(id))).status).toBe(409)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/integration/curation-routes.test.ts`
Expected: FAIL — the three route modules do not exist.

- [ ] **Step 3: Implement the three routes**

`src/app/api/admin/questions/[id]/score/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { scoreQuestion } from '@/lib/curation'
import { IneligibleError, NotFoundError } from '@/lib/errors'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const scores = await scoreQuestion(id)
    return NextResponse.json({ scores })
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (err instanceof IneligibleError) return NextResponse.json({ error: 'Not clustered' }, { status: 409 })
    // Remaining failures are the LLM call itself (transport or output validation).
    console.error('[POST /api/admin/questions/:id/score]', err)
    return NextResponse.json({ error: 'Scoring service unavailable' }, { status: 502 })
  }
}
```

`src/app/api/admin/questions/[id]/scores/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { currentScores, listScores } from '@/lib/curation'
import { NotFoundError } from '@/lib/errors'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const history = await listScores(id)
    return NextResponse.json({ current: currentScores(history), history })
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    console.error('[GET /api/admin/questions/:id/scores]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

`src/app/api/admin/questions/[id]/promote/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { promoteToCanonical } from '@/lib/curation'
import { IneligibleError, NotFoundError } from '@/lib/errors'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const updated = await promoteToCanonical(id, 'admin') // single shared admin account, as in Slices 2–3
    return NextResponse.json({ status: 'canonical', question: updated })
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (err instanceof IneligibleError) return NextResponse.json({ error: 'Not clustered' }, { status: 409 })
    console.error('[POST /api/admin/questions/:id/promote]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run all tests**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/admin/questions/[id]/score" "src/app/api/admin/questions/[id]/scores" "src/app/api/admin/questions/[id]/promote" tests/integration/curation-routes.test.ts
git commit -m "feat: add score, scores, and promote admin API routes"
```

---

### Task 6: Admin curation page

**Files:**
- Create: `src/app/admin/curation/page.tsx`

No component-level test — page behaviour is covered end-to-end in Task 7, matching how the moderation and refinement pages are tested.

- [ ] **Step 1: Implement the page**

Mirrors `src/app/admin/refinement/page.tsx` (same inline-style, fetch-on-mount, `role="status"` message conventions):

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'

interface Clustered {
  id: string
  canonicalText: string
  createdAt: string
}

interface ScoreRow {
  id: string
  criterion: string
  score: number
  rationale: string
  model: string
  modelVersion: string
  timestamp: string
}

export default function CurationPage() {
  const [questions, setQuestions] = useState<Clustered[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState<Clustered | null>(null)
  const [current, setCurrent] = useState<ScoreRow[]>([])
  const [history, setHistory] = useState<ScoreRow[]>([])

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/questions?state=clustered')
    if (res.ok) setQuestions((await res.json()).questions)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  async function loadScores(id: string) {
    const res = await fetch(`/api/admin/questions/${id}/scores`)
    if (res.ok) {
      const data = await res.json()
      setCurrent(data.current)
      setHistory(data.history)
    }
  }

  async function open(q: Clustered) {
    setActive(q)
    setCurrent([])
    setHistory([])
    setMessage('')
    await loadScores(q.id)
  }

  async function score() {
    if (!active) return
    setBusy(true)
    setMessage('Asking the model…')
    try {
      const res = await fetch(`/api/admin/questions/${active.id}/score`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setMessage('')
        await loadScores(active.id)
      } else {
        setMessage(data.error ?? 'Error')
      }
    } catch {
      setMessage('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function promote() {
    if (!active) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/questions/${active.id}/promote`, { method: 'POST' })
      const data = await res.json()
      setMessage(res.ok ? 'Promoted to canonical.' : (data.error ?? 'Error'))
      if (res.ok) setActive(null)
    } catch {
      setMessage('Network error — please try again.')
    } finally {
      setBusy(false)
      load()
    }
  }

  const average =
    current.length > 0
      ? (current.reduce((sum, row) => sum + row.score, 0) / current.length).toFixed(1)
      : null

  // One scoring run = one shared timestamp (rows insert in a single statement).
  const runCount = new Set(history.map((row) => row.timestamp)).size

  return (
    <main style={{ maxWidth: 720, margin: '4rem auto', fontFamily: 'system-ui' }}>
      <h1>Curation</h1>
      {message && <p role="status">{message}</p>}

      {active ? (
        <section>
          <p>
            <strong>Question:</strong> {active.canonicalText}
          </p>
          <button type="button" onClick={score} disabled={busy}>
            Score definedness
          </button>{' '}
          <button type="button" onClick={promote} disabled={busy}>
            Promote to canonical
          </button>{' '}
          <button type="button" onClick={() => setActive(null)} disabled={busy}>
            Back
          </button>

          {current.length > 0 ? (
            <>
              <p>
                <strong>Average: {average}</strong> (advisory — promotion is your call)
              </p>
              <ul>
                {current.map((row) => (
                  <li key={row.criterion}>
                    {row.criterion}: {row.score} / 5 — {row.rationale}
                  </li>
                ))}
              </ul>
              {runCount > 1 && (
                <details>
                  <summary>Score history ({runCount} runs)</summary>
                  <ul>
                    {history.map((row) => (
                      <li key={row.id}>
                        [{new Date(row.timestamp).toLocaleString()}] {row.criterion}: {row.score} / 5 ({row.model})
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          ) : (
            <p>No scores yet — scoring is optional; you can promote without it.</p>
          )}
        </section>
      ) : questions.length === 0 ? (
        <p>No clustered questions to curate.</p>
      ) : (
        <ul>
          {questions.map((q) => (
            <li key={q.id} style={{ marginBottom: '1rem' }}>
              <div>{q.canonicalText}</div>
              <button type="button" onClick={() => open(q)} disabled={busy}>
                Curate
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Verify build-level health**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean. (Behaviour is verified by the e2e test in Task 7.)

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/curation/page.tsx
git commit -m "feat: add admin curation UI (score + promote)"
```

---

### Task 7: End-to-end test

**Files:**
- Test: `tests/e2e/admin-curation.spec.ts`

- [ ] **Step 1: Write the e2e test**

Follows `tests/e2e/admin-refinement.spec.ts` exactly (Playwright runs its own server on port 3100 with `REASONING_PROVIDER=mock`; `MockProvider.score()` returns all-4s with `mock <criterion> rationale`):

```ts
import { test, expect } from '@playwright/test'

// Requires the docker stack up, the dev db seeded, and ADMIN_PASSWORD/ADMIN_SESSION_SECRET in .env.
// The dev server runs with REASONING_PROVIDER=mock (see playwright.config.ts), so no live model is needed.
test('admin scores then promotes a clustered question', async ({ page, request }) => {
  const password = process.env.ADMIN_PASSWORD ?? 'admin'
  const unique = `e2e curation ${Date.now()} — how do we fix education?`

  // Create a submission, then approve it through the API to reach the `clustered` state.
  const created = await request.post('/api/questions', {
    data: { rawText: unique, visibility: 'public', decision: { type: 'new' } },
  })
  expect(created.ok()).toBeTruthy()
  const {
    question: { id },
  } = await created.json()

  // Log in (sets the admin session cookie shared by page + request).
  await page.goto('/admin/login')
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /log in/i }).click()
  await expect(page).toHaveURL(/\/admin\/moderation/)

  const approve = await page.request.post(`/api/admin/questions/${id}/approve`)
  expect(approve.ok()).toBeTruthy()

  // Open the curation page; our question should be listed.
  await page.goto('/admin/curation')
  const row = page.locator('li', { hasText: unique })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Curate' }).click()

  // Score: the deterministic mock breakdown renders (all five criteria at 4/5, average 4.0).
  await page.getByRole('button', { name: 'Score definedness' }).click()
  await expect(page.getByText('Average: 4.0')).toBeVisible()
  await expect(page.getByText('specific: 4 / 5 — mock specific rationale')).toBeVisible()
  await expect(page.getByText('single-barrelled: 4 / 5 — mock single-barrelled rationale')).toBeVisible()

  // Promote: advisory scores don't gate it; the question leaves the clustered list.
  await page.getByRole('button', { name: 'Promote to canonical' }).click()
  await expect(page.getByRole('status')).toContainText(/promoted to canonical/i)
  await expect(page.locator('li', { hasText: unique })).toHaveCount(0)

  // State really is canonical now: a second promote is rejected, and the five score rows persist.
  const again = await page.request.post(`/api/admin/questions/${id}/promote`)
  expect(again.status()).toBe(409)
  const scores = await page.request.get(`/api/admin/questions/${id}/scores`)
  const { history } = await scores.json()
  expect(history).toHaveLength(5)
})
```

- [ ] **Step 2: Run the e2e suite**

Run: `npm run test:e2e`
Expected: 4 tests pass (3 existing + this one). Playwright manages its own server on port 3100 — do not start one manually.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/admin-curation.spec.ts
git commit -m "test: add end-to-end curation flow (score then promote)"
```

---

### Task 8: Full verification + tracking docs

**Files:**
- Modify: `PLAN.md` (mark Slice 4 done)
- Modify: `STATE.md` (component row + position note)

- [ ] **Step 1: Full verification run**

```bash
npm test && npm run lint && npx tsc --noEmit && npm run test:e2e
```

Expected: everything green. Report the actual counts.

- [ ] **Step 2: Update tracking docs**

In `PLAN.md`, change the Slice 4 line to:

```markdown
- [x] Slice 4: Definedness scoring at curation + admin canonical-set curation — append-only `definedness_score` (1–5 + rationale per criterion, advisory), generic `complete()` provider core, audited `clustered → canonical` promotion, `/admin/curation` UI; unit/integration + e2e green
```

and mark Slice 5 as `— CURRENT`.

In `STATE.md`, set the "Definedness scoring + curation" component row to ✅ Done with a matching one-line note, update the "WE ARE HERE" note to "Slices 1–4 built + tested; Slices 5–7 next", and bump the "Last updated" date.

- [ ] **Step 3: Commit**

```bash
git add PLAN.md STATE.md
git commit -m "docs: mark Slice 4 (definedness scoring + curation) complete"
```

- [ ] **Step 4: Whole-slice review**

Per the Slice 3 rhythm: request a code review of the whole branch diff (`git diff main...HEAD`) before merging. Address findings as follow-up commits on the branch.
