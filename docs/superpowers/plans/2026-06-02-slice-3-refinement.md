# Slice 3 — LLM-assisted refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin turn a `clustered` question into a better-formed one via an LLM-assisted, human-decided refinement, capturing every decision as an append-only `refinement` row (the open training set).

**Architecture:** A pluggable reasoning-LLM provider (`src/lib/llm.ts`) returns a validated rewrite + per-criterion critique; an orchestration lib (`src/lib/refinement.ts`) guards eligibility and records the append-only row, updating `canonical_text` transactionally on accept/edit (no re-embedding, no state change). Admin-only API routes and a `/admin/refinement` page drive it. Providers: local Ollama (default `qwen2.5:7b`), Ollama Cloud, OpenRouter — selected by env.

**Tech Stack:** Next.js 15 (App Router), Drizzle ORM + Postgres/pgvector, Ollama, zod (new), Vitest, Playwright.

**Reference:** design spec `docs/superpowers/specs/2026-06-02-slice-3-refinement-design.md`; rubric `definedness-rubric.md`.

---

## File Structure

- `src/lib/llm.ts` — **new.** Provider interface, zod suggestion schema, rubric prompt builder, `OllamaChatProvider` (local + cloud), `OpenRouterProvider`, `MockProvider` (e2e), `getProvider()`. Throws `ProviderError` on LLM/parse failure.
- `src/lib/refinement.ts` — **new.** `suggestRefinement` (eligibility + provider call), `recordRefinement` (append-only row + transactional canonical update), `listClustered`, typed `NotFoundError`/`IneligibleError`.
- `src/db/schema.ts` — **modify.** Add `refinement` table + two enums.
- `drizzle/0002_*.sql` + snapshot — **generated.**
- `src/app/api/admin/questions/route.ts` — **modify.** Support `state=clustered`.
- `src/app/api/admin/questions/[id]/refine/suggest/route.ts` — **new.** POST → suggestion.
- `src/app/api/admin/questions/[id]/refine/route.ts` — **new.** POST → record decision.
- `src/app/api/admin/questions/[id]/refinements/route.ts` — **new.** GET → history.
- `src/app/admin/refinement/page.tsx` — **new.** Refinement UI.
- `tests/unit/llm.test.ts`, `tests/integration/refinement.test.ts`, `tests/e2e/admin-refinement.spec.ts` — **new.**
- `.env.example`, `playwright.config.ts` — **modify.**

Middleware already guards `/admin/:path*` and `/api/admin/:path*` (no auth work needed). `actorRef` is `'admin'`, matching Slice 2.

---

### Task 1: Add zod + env config

**Files:**
- Modify: `package.json` (via npm)
- Modify: `.env.example`

- [ ] **Step 1: Install zod**

Run: `npm install zod`
Expected: `zod` appears in `package.json` `dependencies`; lockfile updated.

- [ ] **Step 2: Add reasoning-LLM env to `.env.example`**

Append to `.env.example` after the Admin auth block:

```bash

# Reasoning LLM (Slice 3) — provider: ollama (local, default) | ollama-cloud | openrouter | mock
REASONING_PROVIDER=ollama
REASONING_MODEL=qwen2.5:7b
# Ollama Cloud (when REASONING_PROVIDER=ollama-cloud)
OLLAMA_CLOUD_URL=https://ollama.com
OLLAMA_API_KEY=
# OpenRouter (when REASONING_PROVIDER=openrouter)
OPENROUTER_API_KEY=
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: add zod and reasoning-LLM env config for Slice 3"
```

---

### Task 2: Schema — `refinement` table + migration `0002`

**Files:**
- Modify: `src/db/schema.ts`
- Generate: `drizzle/0002_*.sql` + `drizzle/meta/0002_snapshot.json`

- [ ] **Step 1: Add `jsonb` to the pg-core import**

In `src/db/schema.ts`, add `jsonb` to the existing import from `drizzle-orm/pg-core` (alphabetical near `integer`):

```typescript
  integer,
  jsonb,
```

- [ ] **Step 2: Add the two enums**

After `export const moderationActionEnum = ...` add:

```typescript
export const refinementSuggestedByEnum = pgEnum('refinement_suggested_by', ['llm', 'human'])
export const refinementActionEnum = pgEnum('refinement_action', ['accept', 'reject', 'edit'])
```

- [ ] **Step 3: Add the `refinement` table** after the `moderationEvent` table definition:

```typescript
// Append-only training set: every LLM-assisted improvement to a question (spec §4).
// Rows are never mutated — corrections are new rows. canonical_text on `question` is the
// only thing an accepted/edited refinement updates. Embeddings are NOT touched (spec §8).
export const refinement = pgTable(
  'refinement',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => question.id),
    before: text('before').notNull(), // canonical_text at suggestion time
    llmSuggestedText: text('llm_suggested_text'), // the model's proposal (null for pure-human)
    after: text('after'), // text actually applied; null on reject
    criteriaApplied: text('criteria_applied').array(),
    critique:
      jsonb('critique').$type<{ criterion: string; verdict: 'pass' | 'fail'; note: string }[]>(),
    suggestedBy: refinementSuggestedByEnum('suggested_by').notNull(),
    model: text('model'),
    modelVersion: text('model_version'),
    action: refinementActionEnum('action').notNull(),
    actorRef: text('actor_ref').notNull(),
    rationale: text('rationale'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('refinement_question_idx').on(table.questionId)],
)
```

- [ ] **Step 4: Export the inferred types** at the bottom with the other exports:

```typescript
export type Refinement = typeof refinement.$inferSelect
export type NewRefinement = typeof refinement.$inferInsert
```

- [ ] **Step 5: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0002_*.sql` containing `CREATE TYPE "public"."refinement_suggested_by"`, `CREATE TYPE "public"."refinement_action"`, and `CREATE TABLE "refinement"`, plus a `0002_snapshot.json`.

- [ ] **Step 6: Apply to dev and test databases**

Run:
```bash
npm run db:migrate
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate
```
Expected: both runs report migration `0002` applied with no error.

- [ ] **Step 7: Verify the table exists**

Run: `docker compose exec -T db psql -U qb -d qb_test -c '\d refinement'`
Expected: the `refinement` table prints with the columns above.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat: add append-only refinement table and migration"
```

---

### Task 3: LLM provider layer (`src/lib/llm.ts`)

**Files:**
- Create: `src/lib/llm.ts`
- Test: `tests/unit/llm.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/llm.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildRefinementPrompt,
  OllamaChatProvider,
  ProviderError,
  refinementSuggestionSchema,
} from '@/lib/llm'

afterEach(() => vi.restoreAllMocks())

const VALID = {
  suggestedText: 'What should UK secondary schools prioritise in 2026?',
  critique: [
    { criterion: 'specific', verdict: 'pass', note: 'concrete' },
    { criterion: 'scoped', verdict: 'fail', note: 'no timeframe' },
  ],
  criteriaApplied: ['scoped'],
  rationale: 'Added a timeframe to bound the question.',
}

function chatResponse(content: unknown) {
  return new Response(JSON.stringify({ message: { content: JSON.stringify(content) } }), {
    status: 200,
  })
}

describe('buildRefinementPrompt', () => {
  it('embeds all five rubric criteria and the question text', () => {
    const prompt = buildRefinementPrompt('How do we fix education?')
    for (const c of ['specific', 'answerable', 'scoped', 'non-leading', 'single-barrelled']) {
      expect(prompt).toContain(c)
    }
    expect(prompt).toContain('How do we fix education?')
  })
})

describe('refinementSuggestionSchema', () => {
  it('accepts a well-formed suggestion', () => {
    expect(() => refinementSuggestionSchema.parse(VALID)).not.toThrow()
  })
  it('rejects an unknown criterion', () => {
    expect(() => refinementSuggestionSchema.parse({ ...VALID, criteriaApplied: ['nope'] })).toThrow()
  })
})

describe('OllamaChatProvider', () => {
  it('posts to /api/chat (no auth for local) and returns a validated suggestion', async () => {
    const fetchMock = vi
      .fn()
      // first call: /api/chat ; second call: /api/tags for the digest
      .mockResolvedValueOnce(chatResponse(VALID))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ models: [{ name: 'qwen2.5:7b', digest: 'sha256:abc' }] }), {
          status: 200,
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const provider = new OllamaChatProvider({ baseUrl: 'http://localhost:11434', model: 'qwen2.5:7b' })
    const result = await provider.refine('How do we fix education?')

    expect(result.suggestedText).toBe(VALID.suggestedText)
    expect(result.model).toBe('qwen2.5:7b')
    expect(result.modelVersion).toBe('sha256:abc')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/api\/chat$/)
    expect(init.headers.Authorization).toBeUndefined()
  })

  it('sends a bearer token when an apiKey is set (Ollama Cloud)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse(VALID))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new OllamaChatProvider({
      baseUrl: 'https://ollama.com',
      model: 'qwen2.5:7b',
      apiKey: 'secret',
    })
    await provider.refine('How do we fix education?')

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer secret')
  })

  it('falls back to the model id when the digest cannot be resolved', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(chatResponse(VALID))
      .mockResolvedValueOnce(new Response('nope', { status: 500 })) // /api/tags fails
    vi.stubGlobal('fetch', fetchMock)

    const provider = new OllamaChatProvider({ baseUrl: 'http://localhost:11434', model: 'qwen2.5:7b' })
    const result = await provider.refine('How do we fix education?')
    expect(result.modelVersion).toBe('qwen2.5:7b')
  })

  it('retries once then throws ProviderError on malformed JSON', async () => {
    const bad = new Response(JSON.stringify({ message: { content: 'not json' } }), { status: 200 })
    const fetchMock = vi.fn().mockResolvedValue(bad)
    vi.stubGlobal('fetch', fetchMock)

    const provider = new OllamaChatProvider({ baseUrl: 'http://localhost:11434', model: 'qwen2.5:7b' })
    await expect(provider.refine('x')).rejects.toBeInstanceOf(ProviderError)
    // 2 attempts, each a single /api/chat call (digest never reached)
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/api/chat'))).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/unit/llm.test.ts`
Expected: FAIL — `Cannot find module '@/lib/llm'`.

- [ ] **Step 3: Implement `src/lib/llm.ts`**

```typescript
import { z } from 'zod'
import { getModelDigest } from '@/lib/ollama'

/** The five definedness criteria (mirrors definedness-rubric.md). */
export const CRITERIA = ['specific', 'answerable', 'scoped', 'non-leading', 'single-barrelled'] as const

const criterionCritiqueSchema = z.object({
  criterion: z.enum(CRITERIA),
  verdict: z.enum(['pass', 'fail']),
  note: z.string(),
})

export const refinementSuggestionSchema = z.object({
  suggestedText: z.string().min(1),
  critique: z.array(criterionCritiqueSchema),
  criteriaApplied: z.array(z.enum(CRITERIA)),
  rationale: z.string(),
})

export type RefinementSuggestion = z.infer<typeof refinementSuggestionSchema> & {
  model: string
  modelVersion: string
}

export interface RefinementProvider {
  refine(canonicalText: string): Promise<RefinementSuggestion>
}

/** Raised on any LLM transport or output-validation failure → maps to HTTP 502. */
export class ProviderError extends Error {}

const REFINE_TIMEOUT_MS = 60_000

const RUBRIC = `A well-defined question satisfies five independent criteria:
- specific: concrete enough to act on, not vague.
- answerable: evidence or reasoning could in principle settle it.
- scoped: has clear boundaries (domain / population / timeframe).
- non-leading: does not presuppose its own answer or embed bias.
- single-barrelled: asks about exactly one thing.`

export function buildRefinementPrompt(canonicalText: string): string {
  return `You improve questions against a definedness rubric.

${RUBRIC}

Question to refine:
"""${canonicalText}"""

Return ONLY a JSON object with this exact shape:
{
  "suggestedText": "the improved question",
  "critique": [{ "criterion": <one of the five>, "verdict": "pass" | "fail", "note": "short reason" }, ... one entry per criterion ...],
  "criteriaApplied": [<criteria your rewrite actually changed>],
  "rationale": "one or two sentences explaining the rewrite"
}`
}

/** Shared chat-provider logic: build prompt, call, validate, retry once, resolve model_version. */
abstract class ChatProvider implements RefinementProvider {
  constructor(protected readonly model: string) {}

  protected abstract callChat(prompt: string): Promise<unknown>
  protected abstract resolveModelVersion(): Promise<string>

  async refine(canonicalText: string): Promise<RefinementSuggestion> {
    const prompt = buildRefinementPrompt(canonicalText)
    let lastErr: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await this.callChat(prompt)
        const parsed = refinementSuggestionSchema.parse(raw)
        const modelVersion = await this.resolveModelVersion()
        return { ...parsed, model: this.model, modelVersion }
      } catch (err) {
        lastErr = err
      }
    }
    const message = lastErr instanceof Error ? lastErr.message : String(lastErr)
    throw new ProviderError(`Refinement failed: ${message}`)
  }
}

/** Local Ollama AND Ollama Cloud — same /api/chat shape; cloud just adds a bearer token. */
export class OllamaChatProvider extends ChatProvider {
  private readonly baseUrl: string
  private readonly apiKey?: string

  constructor(opts: { baseUrl: string; model: string; apiKey?: string }) {
    super(opts.model)
    this.baseUrl = opts.baseUrl
    this.apiKey = opts.apiKey
  }

  protected async callChat(prompt: string): Promise<unknown> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        format: 'json',
      }),
      signal: AbortSignal.timeout(REFINE_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`Ollama chat failed: ${res.status} ${await res.text()}`)
    const data = (await res.json()) as { message?: { content?: string } }
    return JSON.parse(data.message?.content ?? '')
  }

  protected async resolveModelVersion(): Promise<string> {
    try {
      // getModelDigest reads OLLAMA_URL; for the common local case that is this.baseUrl.
      return await getModelDigest(this.model)
    } catch {
      return this.model // cloud / unresolvable digest → record the model id
    }
  }
}

/** OpenRouter — OpenAI-compatible chat completions. */
export class OpenRouterProvider extends ChatProvider {
  private readonly baseUrl: string
  private readonly apiKey: string

  constructor(opts: { baseUrl: string; model: string; apiKey: string }) {
    super(opts.model)
    this.baseUrl = opts.baseUrl
    this.apiKey = opts.apiKey
  }

  protected async callChat(prompt: string): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(REFINE_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`OpenRouter chat failed: ${res.status} ${await res.text()}`)
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return JSON.parse(data.choices?.[0]?.message?.content ?? '')
  }

  protected async resolveModelVersion(): Promise<string> {
    return this.model // remote model id is the version identifier
  }
}

/** Deterministic provider for e2e (REASONING_PROVIDER=mock) — never calls the network. */
export class MockProvider implements RefinementProvider {
  async refine(canonicalText: string): Promise<RefinementSuggestion> {
    return {
      suggestedText: `${canonicalText} (refined)`,
      critique: CRITERIA.map((criterion) => ({ criterion, verdict: 'pass', note: 'ok' })),
      criteriaApplied: ['specific'],
      rationale: 'Mock refinement for end-to-end tests.',
      model: 'mock',
      modelVersion: 'mock',
    }
  }
}

export function getProvider(): RefinementProvider {
  const provider = process.env.REASONING_PROVIDER ?? 'ollama'
  const model = process.env.REASONING_MODEL ?? 'qwen2.5:7b'
  switch (provider) {
    case 'ollama':
      return new OllamaChatProvider({
        baseUrl: process.env.OLLAMA_URL ?? 'http://localhost:11434',
        model,
      })
    case 'ollama-cloud':
      return new OllamaChatProvider({
        baseUrl: process.env.OLLAMA_CLOUD_URL ?? 'https://ollama.com',
        model,
        apiKey: process.env.OLLAMA_API_KEY,
      })
    case 'openrouter':
      return new OpenRouterProvider({
        baseUrl: 'https://openrouter.ai/api/v1',
        model,
        apiKey: process.env.OPENROUTER_API_KEY ?? '',
      })
    case 'mock':
      return new MockProvider()
    default:
      throw new Error(`Unknown REASONING_PROVIDER: ${provider}`)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/unit/llm.test.ts`
Expected: PASS (all cases in the file).

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm.ts tests/unit/llm.test.ts
git commit -m "feat: add pluggable reasoning-LLM provider with validated output"
```

---

### Task 4: Refinement orchestration (`src/lib/refinement.ts`)

**Files:**
- Create: `src/lib/refinement.ts`
- Test: `tests/integration/refinement.test.ts`

- [ ] **Step 1: Write the failing integration tests**

Create `tests/integration/refinement.test.ts`:

```typescript
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { datasetVersion, question, refinement } from '@/db/schema'
import type { RefinementProvider, RefinementSuggestion } from '@/lib/llm'
import {
  IneligibleError,
  listClustered,
  recordRefinement,
  suggestRefinement,
} from '@/lib/refinement'

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

const SUGGESTION: RefinementSuggestion = {
  suggestedText: 'refined text',
  critique: [{ criterion: 'specific', verdict: 'fail', note: 'too vague' }],
  criteriaApplied: ['specific'],
  rationale: 'made it concrete',
  model: 'qwen2.5:7b',
  modelVersion: 'sha256:abc',
}
const stubProvider: RefinementProvider = { refine: async () => SUGGESTION }

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ${refinement} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${question} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${datasetVersion} RESTART IDENTITY CASCADE`)
  const [v] = await db
    .insert(datasetVersion)
    .values({
      embeddingModel: 'test',
      embeddingModelDigest: 'sha256:test',
      embeddingDim: 768,
    })
    .returning()
  versionId = v.id
})
afterAll(async () => {
  await pool.end()
})

describe('listClustered', () => {
  it('returns only clustered questions, oldest first', async () => {
    await insert('submitted one', 'submitted')
    await insert('clustered one', 'clustered')
    const rows = await listClustered()
    expect(rows.map((r) => r.canonicalText)).toEqual(['clustered one'])
  })
})

describe('suggestRefinement', () => {
  it('returns the before text and a suggestion for a clustered question', async () => {
    const id = await insert('How do we fix education?', 'clustered')
    const { before, suggestion } = await suggestRefinement(id, stubProvider)
    expect(before).toBe('How do we fix education?')
    expect(suggestion.suggestedText).toBe('refined text')
  })

  it('throws IneligibleError for a non-clustered question', async () => {
    const id = await insert('pending', 'submitted')
    await expect(suggestRefinement(id, stubProvider)).rejects.toBeInstanceOf(IneligibleError)
  })
})

describe('recordRefinement', () => {
  const base = {
    before: 'How do we fix education?',
    llmSuggestedText: 'refined text',
    criteriaApplied: ['specific'],
    critique: SUGGESTION.critique,
    rationale: 'made it concrete',
    model: 'qwen2.5:7b',
    modelVersion: 'sha256:abc',
    actorRef: 'admin',
  }

  it('accept: writes a row and updates canonical_text', async () => {
    const id = await insert('How do we fix education?', 'clustered')
    const row = await recordRefinement({ ...base, questionId: id, action: 'accept', finalText: 'refined text' })
    expect(row.after).toBe('refined text')
    expect(row.llmSuggestedText).toBe('refined text')
    const [q] = await db.select().from(question).where(eq(question.id, id))
    expect(q.canonicalText).toBe('refined text')
    expect(q.state).toBe('clustered') // unchanged
  })

  it('edit: preserves both the proposal and the human-final text', async () => {
    const id = await insert('How do we fix education?', 'clustered')
    const row = await recordRefinement({
      ...base,
      questionId: id,
      action: 'edit',
      finalText: 'human-corrected text',
    })
    expect(row.llmSuggestedText).toBe('refined text')
    expect(row.after).toBe('human-corrected text')
    const [q] = await db.select().from(question).where(eq(question.id, id))
    expect(q.canonicalText).toBe('human-corrected text')
  })

  it('reject: writes a row with null after and leaves canonical_text unchanged', async () => {
    const id = await insert('How do we fix education?', 'clustered')
    const row = await recordRefinement({ ...base, questionId: id, action: 'reject', finalText: null })
    expect(row.after).toBeNull()
    const [q] = await db.select().from(question).where(eq(question.id, id))
    expect(q.canonicalText).toBe('How do we fix education?')
  })

  it('rejects recording against a non-clustered question', async () => {
    const id = await insert('pending', 'submitted')
    await expect(
      recordRefinement({ ...base, questionId: id, action: 'accept', finalText: 'x' }),
    ).rejects.toBeInstanceOf(IneligibleError)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/integration/refinement.test.ts`
Expected: FAIL — `Cannot find module '@/lib/refinement'`.

- [ ] **Step 3: Implement `src/lib/refinement.ts`**

```typescript
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { question, refinement, type Refinement } from '@/db/schema'
import { getProvider, type RefinementProvider, type RefinementSuggestion } from '@/lib/llm'

export class NotFoundError extends Error {}
export class IneligibleError extends Error {}

/** Questions eligible for refinement: those that have been clustered (spec §5 ordering). */
export async function listClustered(limit = 50) {
  return db
    .select({ id: question.id, canonicalText: question.canonicalText, createdAt: question.createdAt })
    .from(question)
    .where(eq(question.state, 'clustered'))
    .orderBy(asc(question.createdAt))
    .limit(limit)
}

/** Run the reasoning LLM against a clustered question. Does NOT persist anything. */
export async function suggestRefinement(
  questionId: string,
  provider: RefinementProvider = getProvider(),
): Promise<{ before: string; suggestion: RefinementSuggestion }> {
  const [q] = await db.select().from(question).where(eq(question.id, questionId)).limit(1)
  if (!q) throw new NotFoundError(`Question not found: ${questionId}`)
  if (q.state !== 'clustered') throw new IneligibleError(`Question ${questionId} is not clustered (state=${q.state})`)
  const suggestion = await provider.refine(q.canonicalText)
  return { before: q.canonicalText, suggestion }
}

export interface RecordRefinementInput {
  questionId: string
  action: 'accept' | 'reject' | 'edit'
  before: string
  llmSuggestedText: string | null
  finalText: string | null // applied text; ignored (stored null) on reject
  criteriaApplied: string[]
  critique: { criterion: string; verdict: 'pass' | 'fail'; note: string }[]
  rationale: string
  model: string | null
  modelVersion: string | null
  actorRef: string
}

/**
 * Append the refinement row and, on accept/edit, update canonical_text — in one transaction.
 * Embeddings and state are NOT touched (pinned embedding, spec §8; curation→canonical is Slice 4).
 */
export async function recordRefinement(input: RecordRefinementInput): Promise<Refinement> {
  return db.transaction(async (tx) => {
    const [q] = await tx.select().from(question).where(eq(question.id, input.questionId)).limit(1)
    if (!q) throw new NotFoundError(`Question not found: ${input.questionId}`)
    if (q.state !== 'clustered') throw new IneligibleError(`Question ${input.questionId} is not clustered (state=${q.state})`)

    const after = input.action === 'reject' ? null : input.finalText

    const [row] = await tx
      .insert(refinement)
      .values({
        questionId: input.questionId,
        before: input.before,
        llmSuggestedText: input.llmSuggestedText,
        after,
        criteriaApplied: input.criteriaApplied,
        critique: input.critique,
        suggestedBy: 'llm',
        model: input.model,
        modelVersion: input.modelVersion,
        action: input.action,
        actorRef: input.actorRef,
        rationale: input.rationale,
      })
      .returning()

    if (after !== null) {
      await tx.update(question).set({ canonicalText: after }).where(eq(question.id, input.questionId))
    }
    return row
  })
}

/** Refinement history for a question, newest first (transparency view). */
export async function listRefinements(questionId: string): Promise<Refinement[]> {
  return db
    .select()
    .from(refinement)
    .where(eq(refinement.questionId, questionId))
    .orderBy(asc(refinement.timestamp))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/integration/refinement.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/refinement.ts tests/integration/refinement.test.ts
git commit -m "feat: add refinement orchestration (suggest, record, list)"
```

---

### Task 5: Extend the admin questions list for `state=clustered`

**Files:**
- Modify: `src/app/api/admin/questions/route.ts`

- [ ] **Step 1: Replace the route body**

Replace the whole file with:

```typescript
import { NextResponse } from 'next/server'
import { listPending } from '@/lib/moderation'
import { listClustered } from '@/lib/refinement'

export async function GET(request: Request) {
  const state = new URL(request.url).searchParams.get('state') ?? 'submitted'
  if (state === 'submitted') {
    return NextResponse.json({ questions: await listPending() })
  }
  if (state === 'clustered') {
    return NextResponse.json({ questions: await listClustered() })
  }
  return NextResponse.json({ error: 'Only state=submitted or state=clustered is supported' }, { status: 400 })
}
```

- [ ] **Step 2: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/questions/route.ts
git commit -m "feat: list clustered questions from the admin questions API"
```

---

### Task 6: API routes — suggest, refine, refinements

**Files:**
- Create: `src/app/api/admin/questions/[id]/refine/suggest/route.ts`
- Create: `src/app/api/admin/questions/[id]/refine/route.ts`
- Create: `src/app/api/admin/questions/[id]/refinements/route.ts`

- [ ] **Step 1: Implement the suggest route**

Create `src/app/api/admin/questions/[id]/refine/suggest/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { IneligibleError, NotFoundError, suggestRefinement } from '@/lib/refinement'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const result = await suggestRefinement(id)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (err instanceof IneligibleError) return NextResponse.json({ error: 'Not clustered' }, { status: 409 })
    // Remaining failures are the LLM call itself (transport or output validation).
    console.error('[POST /api/admin/questions/:id/refine/suggest]', err)
    return NextResponse.json({ error: 'Refinement service unavailable' }, { status: 502 })
  }
}
```

- [ ] **Step 2: Implement the refine (record-decision) route**

Create `src/app/api/admin/questions/[id]/refine/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { IneligibleError, NotFoundError, recordRefinement } from '@/lib/refinement'

const ACTIONS = ['accept', 'reject', 'edit'] as const

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const action = body.action
  if (typeof action !== 'string' || !ACTIONS.includes(action as (typeof ACTIONS)[number])) {
    return NextResponse.json({ error: 'action must be accept | reject | edit' }, { status: 400 })
  }
  if (typeof body.before !== 'string') {
    return NextResponse.json({ error: 'before is required' }, { status: 400 })
  }

  try {
    const row = await recordRefinement({
      questionId: id,
      action: action as (typeof ACTIONS)[number],
      before: body.before,
      llmSuggestedText: typeof body.llmSuggestedText === 'string' ? body.llmSuggestedText : null,
      finalText: typeof body.finalText === 'string' ? body.finalText : null,
      criteriaApplied: Array.isArray(body.criteriaApplied) ? (body.criteriaApplied as string[]) : [],
      critique: Array.isArray(body.critique)
        ? (body.critique as { criterion: string; verdict: 'pass' | 'fail'; note: string }[])
        : [],
      rationale: typeof body.rationale === 'string' ? body.rationale : '',
      model: typeof body.model === 'string' ? body.model : null,
      modelVersion: typeof body.modelVersion === 'string' ? body.modelVersion : null,
      actorRef: 'admin', // single shared admin account this slice (matches Slice 2)
    })
    return NextResponse.json({ refinement: row })
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (err instanceof IneligibleError) return NextResponse.json({ error: 'Not clustered' }, { status: 409 })
    console.error('[POST /api/admin/questions/:id/refine]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Implement the refinements history route**

Create `src/app/api/admin/questions/[id]/refinements/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { listRefinements } from '@/lib/refinement'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return NextResponse.json({ refinements: await listRefinements(id) })
}
```

- [ ] **Step 4: Verify type-check + lint pass**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/questions
git commit -m "feat: add refinement suggest, record, and history API routes"
```

---

### Task 7: Admin refinement UI (`/admin/refinement`)

**Files:**
- Create: `src/app/admin/refinement/page.tsx`

- [ ] **Step 1: Implement the page** (mirrors the moderation page's fetch/busy/message pattern)

Create `src/app/admin/refinement/page.tsx`:

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'

interface Clustered {
  id: string
  canonicalText: string
  createdAt: string
}

interface Critique {
  criterion: string
  verdict: 'pass' | 'fail'
  note: string
}

interface Suggestion {
  suggestedText: string
  critique: Critique[]
  criteriaApplied: string[]
  rationale: string
  model: string
  modelVersion: string
}

export default function RefinementPage() {
  const [questions, setQuestions] = useState<Clustered[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState<{ id: string; before: string; suggestion: Suggestion } | null>(null)
  const [editedText, setEditedText] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/questions?state=clustered')
    if (res.ok) setQuestions((await res.json()).questions)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  async function suggest(id: string) {
    setBusy(true)
    setMessage('Asking the model…')
    try {
      const res = await fetch(`/api/admin/questions/${id}/refine/suggest`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setActive({ id, before: data.before, suggestion: data.suggestion })
        setEditedText(data.suggestion.suggestedText)
        setMessage('')
      } else {
        setMessage(data.error ?? 'Error')
      }
    } catch {
      setMessage('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function decide(action: 'accept' | 'reject' | 'edit') {
    if (!active) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/questions/${active.id}/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          before: active.before,
          llmSuggestedText: active.suggestion.suggestedText,
          finalText: action === 'reject' ? null : editedText,
          criteriaApplied: active.suggestion.criteriaApplied,
          critique: active.suggestion.critique,
          rationale: active.suggestion.rationale,
          model: active.suggestion.model,
          modelVersion: active.suggestion.modelVersion,
        }),
      })
      const data = await res.json()
      setMessage(res.ok ? `Recorded: ${action}.` : (data.error ?? 'Error'))
      if (res.ok) setActive(null)
    } catch {
      setMessage('Network error — please try again.')
    } finally {
      setBusy(false)
      load()
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: '4rem auto', fontFamily: 'system-ui' }}>
      <h1>Refinement</h1>
      {message && <p role="status">{message}</p>}

      {active ? (
        <section>
          <p>
            <strong>Before:</strong> {active.before}
          </p>
          <label htmlFor="refined">
            <strong>Suggested (editable):</strong>
          </label>
          <textarea
            id="refined"
            style={{ width: '100%', minHeight: '4rem' }}
            value={editedText}
            onChange={(e) => setEditedText(e.target.value)}
          />
          <p>
            <strong>Rationale:</strong> {active.suggestion.rationale}
          </p>
          <ul>
            {active.suggestion.critique.map((c) => (
              <li key={c.criterion}>
                {c.criterion}: {c.verdict} — {c.note}
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => decide('accept')} disabled={busy}>
            Accept
          </button>{' '}
          <button type="button" onClick={() => decide('edit')} disabled={busy}>
            Save edit
          </button>{' '}
          <button type="button" onClick={() => decide('reject')} disabled={busy}>
            Reject
          </button>{' '}
          <button type="button" onClick={() => setActive(null)} disabled={busy}>
            Cancel
          </button>
        </section>
      ) : questions.length === 0 ? (
        <p>No clustered questions to refine.</p>
      ) : (
        <ul>
          {questions.map((q) => (
            <li key={q.id} style={{ marginBottom: '1rem' }}>
              <div>{q.canonicalText}</div>
              <button type="button" onClick={() => suggest(q.id)} disabled={busy}>
                Suggest refinement
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Verify type-check + lint pass**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/refinement/page.tsx
git commit -m "feat: add admin refinement UI"
```

---

### Task 8: End-to-end test (mock provider)

**Files:**
- Modify: `playwright.config.ts`
- Create: `tests/e2e/admin-refinement.spec.ts`

- [ ] **Step 1: Run the e2e dev server with the mock provider**

In `playwright.config.ts`, change the `webServer.command` so the dev server uses the deterministic provider:

```typescript
    command: `PORT=${PORT} REASONING_PROVIDER=mock npm run dev`,
```

- [ ] **Step 2: Write the e2e test**

Create `tests/e2e/admin-refinement.spec.ts`:

```typescript
import { test, expect } from '@playwright/test'

// Requires the docker stack up, the dev db seeded, and ADMIN_PASSWORD/ADMIN_SESSION_SECRET in .env.
// The dev server runs with REASONING_PROVIDER=mock (see playwright.config.ts), so no live model is needed.
test('admin refines a clustered question (suggest → edit → accept)', async ({ page, request }) => {
  const password = process.env.ADMIN_PASSWORD ?? 'admin'
  const unique = `e2e refine ${Date.now()} — how do we fix education?`

  // Create a submission, then approve it through the API to reach the `clustered` state.
  const created = await request.post('/api/questions', {
    data: { rawText: unique, visibility: 'public', decision: { type: 'new' } },
  })
  expect(created.ok()).toBeTruthy()
  const { id } = await created.json()

  // Log in (sets the admin session cookie shared by page + request).
  await page.goto('/admin/login')
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /log in/i }).click()
  await expect(page).toHaveURL(/\/admin\/moderation/)

  const approve = await page.request.post(`/api/admin/questions/${id}/approve`)
  expect(approve.ok()).toBeTruthy()

  // Open the refinement page; our question should be listed.
  await page.goto('/admin/refinement')
  const row = page.locator('li', { hasText: unique })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Suggest refinement' }).click()

  // The mock suggestion appears in the editable textarea; edit it, then accept.
  const textarea = page.getByLabel('Suggested (editable):')
  await expect(textarea).toHaveValue(/refined/)
  await textarea.fill('human-corrected question')
  await page.getByRole('button', { name: 'Save edit' }).click()
  await expect(page.getByRole('status')).toContainText(/recorded: edit/i)

  // The refinement was recorded and canonical_text updated.
  const history = await page.request.get(`/api/admin/questions/${id}/refinements`)
  const { refinements } = await history.json()
  expect(refinements).toHaveLength(1)
  expect(refinements[0].after).toBe('human-corrected question')
  expect(refinements[0].llmSuggestedText).toMatch(/refined/)
})
```

- [ ] **Step 3: Confirm the public submit API returns the new question id**

Run: `grep -n "id" src/app/api/questions/route.ts`
Expected: the POST response includes the created question's `id`. If it does **not**, adjust the test to fetch the id via `GET /api/admin/questions?state=clustered` after approval (match on `canonicalText === unique`) instead of `created.json()`.

- [ ] **Step 4: Run the e2e test**

Run: `npm run test:e2e -- admin-refinement`
Expected: PASS (Playwright starts its own server on :3100 with the mock provider).

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts tests/e2e/admin-refinement.spec.ts
git commit -m "test: add end-to-end admin refinement flow with mock provider"
```

---

### Task 9: Full verification + update tracking docs

**Files:**
- Modify: `PLAN.md`, `STATE.md`, `HANDOFF.md`

- [ ] **Step 1: Run the full check suite**

Run:
```bash
npm test
npx tsc --noEmit
npm run lint
npm run test:e2e
```
Expected: all green — unit + integration (existing 28 + new llm/refinement cases), no type or lint errors, both e2e specs pass.

- [ ] **Step 2: Mark Slice 3 done in `PLAN.md`**

Change the Slice 3 line from `- [ ] Slice 3: ... — CURRENT` to `- [x] Slice 3: LLM-assisted refinement — pluggable provider (Ollama/Cloud/OpenRouter), append-only refinement log, admin UI; tests green` and mark Slice 4 as `CURRENT`.

- [ ] **Step 3: Update `STATE.md`**

Set the "LLM refinement (training set)" component row to ✅ Done with a one-line note, and note the default chat model `qwen2.5:7b` under Dependencies (Ollama row).

- [ ] **Step 4: Rewrite `HANDOFF.md`** to reflect Slice 3 complete and Slice 4 (definedness scoring + canonical curation) as next, carrying forward the deferred follow-ups (client-supplied `llm_suggested_text` trust; OpenRouter/Cloud paths only mock-tested; pure-human refinement deferred).

- [ ] **Step 5: Commit**

```bash
git add PLAN.md STATE.md HANDOFF.md
git commit -m "docs: mark Slice 3 (LLM-assisted refinement) complete"
```

---

## Self-Review

**Spec coverage** (design §1–§10):
- Pluggable provider, local default, three providers → Task 3 (`getProvider`, `OllamaChatProvider` for local+cloud, `OpenRouterProvider`). ✓
- `qwen2.5:7b` default → Task 3 `getProvider`; prerequisite pull called out below. ✓
- One rewrite + structured critique → Task 3 schema + Task 2 `critique` jsonb. ✓
- On-demand, any clustered question, synchronous → Tasks 4–7. ✓
- Edit preserves both texts → Task 2 columns + Task 4 test + Task 8 e2e. ✓
- `critique` jsonb → Task 2. ✓
- No re-embedding, no state change → Task 4 (`recordRefinement` touches only `canonical_text`); asserted in Task 4 test (`state` unchanged). ✓
- Append-only `refinement` table, migration 0002 → Task 2. ✓
- API routes (suggest, refine, history) → Task 6; clustered list → Task 5. ✓
- Admin UI → Task 7. ✓
- Error handling (502 LLM, 409 ineligible, 404 not-found, transactional) → Tasks 4 & 6. ✓
- Trust note (client-carried proposal) → carried to HANDOFF in Task 9. ✓
- Testing unit/integration/e2e → Tasks 3, 4, 8. ✓
- Provenance digest-vs-id fallback → Task 3 (`resolveModelVersion`) + test. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; every command states expected output. ✓ (One conditional in Task 8 Step 3 — explicit fallback instructions, not a placeholder.)

**Type consistency:** `RefinementSuggestion`, `RefinementProvider`, `recordRefinement`/`RecordRefinementInput`, `suggestRefinement`, `listClustered`, `listRefinements`, `NotFoundError`/`IneligibleError`, `ProviderError` are defined once and used consistently across tasks. `critique` shape `{ criterion; verdict: 'pass'|'fail'; note }` matches between schema (Task 2), llm.ts (Task 3), refinement.ts (Task 4), and routes (Task 6). ✓

## Prerequisite (environment)

Before running Task 8's live path or using the real provider in dev: `ollama pull qwen2.5:7b` (the agent must confirm with the user before pulling — it consumes local disk/compute). The unit, integration, and e2e tests do **not** require the model (they mock/stub or use `REASONING_PROVIDER=mock`).
