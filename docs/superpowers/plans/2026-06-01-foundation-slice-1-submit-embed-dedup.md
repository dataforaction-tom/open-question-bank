# Foundation + Slice 1 (Submit → Embed → Dedup-at-source) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Question Bank's local-first stack and ship the first runnable vertical slice — a person can submit a question, have it embedded by a pinned Ollama model, and be shown the nearest existing questions ("is yours one of these, or new?") before it is stored.

**Architecture:** A single Next.js (app router, TypeScript) app talks to a Postgres 16 + pgvector database via Drizzle ORM and to a local Ollama server for embeddings. Both Postgres and Ollama run in `docker compose`. The embedding model (`nomic-embed-text`, 768-dim) is pinned in a `dataset_version` row; every `question` records the model version that embedded it (provenance). Dedup-at-source is a cosine-distance nearest-neighbour query over the active dataset version, gated by a stored threshold.

**Tech Stack:** Next.js 15 (app router) · TypeScript · Postgres 16 + pgvector (`pgvector/pgvector:pg16`) · Ollama (`nomic-embed-text`) · Drizzle ORM `^0.45` + drizzle-kit · `pg` driver · Vitest (unit/integration) · Playwright (e2e) · tsx (TS script runner — host Node is 20, no native TS execution) · npm · Docker Compose.

> **Environment note:** the host runs **Node 20** — it cannot execute `.ts` files natively, so the seed script runs via `tsx`. The Docker image uses Node 22, which is independent of the host.

---

## File Structure

| Path | Responsibility |
|------|----------------|
| `package.json`, `tsconfig.json`, `next.config.ts` | Project scaffold and TypeScript config |
| `.env.example`, `.env` | `DATABASE_URL`, `TEST_DATABASE_URL`, `OLLAMA_URL`, `EMBEDDING_MODEL`, `EMBEDDING_DIM`, `DEDUP_THRESHOLD` |
| `docker-compose.yml` | Postgres+pgvector and Ollama services (+ app in Task 15) |
| `db/init/00-extensions.sql` | Enables the `vector` extension at DB init |
| `drizzle.config.ts` | drizzle-kit config (schema path, migrations dir, DB URL) |
| `src/db/schema.ts` | Drizzle schema: `dataset_version`, `question`, enums, HNSW index, one-active-version constraint |
| `src/db/client.ts` | `pg` pool + Drizzle client singleton |
| `src/lib/ollama.ts` | Low-level Ollama HTTP client: `embed()`, `getModelDigest()` |
| `src/lib/dataset-version.ts` | Read/seed the active pinned dataset version |
| `src/lib/embedding.ts` | `embedForActiveVersion()` — embeds text + returns model-version provenance |
| `src/lib/dedup.ts` | `findNearest()` — cosine-distance nearest-neighbour query |
| `src/lib/submission.ts` | `prepareSubmission()` + `createQuestion()` — the orchestration |
| `scripts/seed-dataset-version.ts` | One-off: pin the active dataset version (run via `tsx`) |
| `src/app/api/questions/route.ts` | `POST` endpoint driving the submit/dedup flow |
| `src/app/submit/page.tsx` | Submit form with "yours or new?" candidate UI |
| `src/app/page.tsx`, `src/app/layout.tsx` | Home page + root layout |
| `drizzle/` | Generated SQL migrations |
| `tests/unit/*.test.ts` | Pure-logic unit tests (mocked fetch) |
| `tests/integration/*.test.ts` | DB-backed tests against `TEST_DATABASE_URL` |
| `tests/e2e/submit.spec.ts` | Playwright end-to-end submit flow |
| `vitest.config.ts`, `tests/setup-integration.ts` | Test runner config + integration DB setup |
| `playwright.config.ts` | Playwright config |

**Conventions:** path alias `@/` → `src/`. Cosine *distance* (pgvector `<=>`, range 0–2) is used throughout; smaller = more similar. The dedup threshold is a **maximum distance** — candidates with `distance < threshold` are shown.

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "open-question-bank",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:seed": "tsx scripts/seed-dataset-version.ts"
  }
}
```

- [ ] **Step 2: Install dependencies (pinned where it matters)**

Run:
```bash
npm install next@15 react@19 react-dom@19 "drizzle-orm@^0.45" pg dotenv
npm install -D typescript @types/node @types/react @types/react-dom @types/pg \
  drizzle-kit vitest @playwright/test eslint eslint-config-next tsx
npx playwright install chromium
```
Expected: dependencies resolve; `node_modules/` created (already gitignored). `drizzle-orm` must be `>=0.32` for the `vector` column type and `cosineDistance` helper — `^0.45` guarantees this.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create `next.config.ts`**

```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // `pg` is a server-only dependency; keep it out of client/edge bundling.
  serverExternalPackages: ['pg'],
}

export default nextConfig
```

- [ ] **Step 5: Create `src/app/layout.tsx`**

```tsx
import type { ReactNode } from 'react'

export const metadata = {
  title: 'Question Bank',
  description: 'A collective intelligence and prioritisation tool for questions.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 6: Create `src/app/page.tsx`**

```tsx
import Link from 'next/link'

export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: '4rem auto', fontFamily: 'system-ui' }}>
      <h1>Question Bank</h1>
      <p>A collective intelligence and prioritisation tool for questions.</p>
      <p>
        <Link href="/submit">Submit a question →</Link>
      </p>
    </main>
  )
}
```

- [ ] **Step 7: Verify the app builds**

Run: `npm run build`
Expected: build succeeds, reporting the `/` route. (The `/submit` route is added in Task 13.)

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts src/app/layout.tsx src/app/page.tsx
git commit -m "chore: scaffold Next.js app with TypeScript"
```

---

## Task 2: Docker Compose — Postgres/pgvector + Ollama

**Files:**
- Create: `docker-compose.yml`, `db/init/00-extensions.sql`, `.env.example`
- Modify: `.env` (local, gitignored — create from example)

- [ ] **Step 1: Create `db/init/00-extensions.sql`**

```sql
-- Runs once at first DB init (mounted into the pgvector image's init dir).
CREATE EXTENSION IF NOT EXISTS vector;
```

- [ ] **Step 2: Create `docker-compose.yml`**

```yaml
services:
  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: qb
      POSTGRES_PASSWORD: qb
      POSTGRES_DB: qb
    ports:
      - "5432:5432"
    volumes:
      - qb_pgdata:/var/lib/postgresql/data
      - ./db/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U qb -d qb"]
      interval: 5s
      timeout: 5s
      retries: 10

  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - qb_ollama:/root/.ollama
    healthcheck:
      # `ollama` CLI ships in the image (curl does not); `ollama list` succeeds once the API is up.
      test: ["CMD", "ollama", "list"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  qb_pgdata:
  qb_ollama:
```

- [ ] **Step 3: Create `.env.example`**

```bash
# Postgres (matches docker-compose.yml)
DATABASE_URL=postgres://qb:qb@localhost:5432/qb
# Separate database for integration tests (created in Task 5)
TEST_DATABASE_URL=postgres://qb:qb@localhost:5432/qb_test

# Ollama
OLLAMA_URL=http://localhost:11434

# Pinned embedding model (Slice 1 default — see spec §3)
EMBEDDING_MODEL=nomic-embed-text
EMBEDDING_DIM=768

# Dedup-at-source: maximum cosine distance to treat as a candidate match (0–2, smaller = closer)
DEDUP_THRESHOLD=0.15
```

- [ ] **Step 4: Create local `.env`**

Run: `cp .env.example .env`
Expected: `.env` exists (already gitignored).

- [ ] **Step 5: Bring services up and verify**

Run:
```bash
docker compose up -d
docker compose ps
```
Expected: both `db` and `ollama` report healthy.

- [ ] **Step 6: Pull the embedding model and CONFIRM 768 dims (hard gate)**

Run:
```bash
docker compose exec ollama ollama pull nomic-embed-text
curl -s http://localhost:11434/api/embed -d '{"model":"nomic-embed-text","input":"test"}' \
  | python3 -c "import sys,json; print(len(json.load(sys.stdin)['embeddings'][0]))"
```
Expected: prints `768`. **If it does not print 768, STOP** — `EMBEDDING_DIM` and the `vector(768)` column width in Task 4 both depend on this being exactly 768.

- [ ] **Step 7: Confirm the vector extension is enabled**

Run: `docker compose exec db psql -U qb -d qb -c "SELECT extname FROM pg_extension WHERE extname='vector';"`
Expected: one row, `vector`.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml db/init/00-extensions.sql .env.example
git commit -m "chore: add docker compose stack (postgres/pgvector + ollama)"
```

---

## Task 3: Drizzle client and config

**Files:**
- Create: `drizzle.config.ts`, `src/db/client.ts`

- [ ] **Step 1: Create `drizzle.config.ts`**

```ts
import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
```

- [ ] **Step 2: Create `src/db/client.ts`**

```ts
import 'dotenv/config'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is not set')
}

// Reuse a single pool across hot-reloads in dev.
const globalForDb = globalThis as unknown as { __qbPool?: Pool }
const pool = globalForDb.__qbPool ?? new Pool({ connectionString })
if (process.env.NODE_ENV !== 'production') globalForDb.__qbPool = pool

export const db = drizzle(pool, { schema })
export { pool }
```

> Note: `import 'dotenv/config'` is redundant under Next.js (which loads `.env` itself) but harmless, and it ensures the env is present when `client.ts` is imported by tests and the seed script. Kept deliberately.

- [ ] **Step 3: Commit** (the schema arrives in Task 4; no typecheck here — `./schema` does not exist yet)

```bash
git add drizzle.config.ts src/db/client.ts
git commit -m "feat: add drizzle client and config"
```

---

## Task 4: Database schema — `dataset_version` and `question`

**Files:**
- Create: `src/db/schema.ts`
- Create (generated): `drizzle/0000_*.sql`

- [ ] **Step 1: Create `src/db/schema.ts`**

```ts
import { sql } from 'drizzle-orm'
import {
  pgTable,
  pgEnum,
  serial,
  uuid,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  vector,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'

export const visibilityEnum = pgEnum('visibility', ['anonymous', 'public'])

// Full lifecycle from spec §5. Slice 1 only ever writes 'submitted' or 'merged_as_variant';
// the remaining states land in later slices but are declared now so the enum is stable.
export const questionStateEnum = pgEnum('question_state', [
  'submitted',
  'flagged',
  'rejected',
  'merged_as_variant',
  'clustered',
  'canonical',
  'under_comparison',
  'ranked',
  'synthesised',
  'archived',
])

// One row per pinned-embedding configuration. Changing the embedding model mints a NEW row
// (and, later, a re-embed migration). Exactly one row is active at a time (enforced below).
export const datasetVersion = pgTable(
  'dataset_version',
  {
    id: serial('id').primaryKey(),
    embeddingModel: text('embedding_model').notNull(),
    embeddingModelDigest: text('embedding_model_digest').notNull(),
    embeddingDim: integer('embedding_dim').notNull(),
    dedupThreshold: doublePrecision('dedup_threshold').notNull().default(0.15),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // At most one active version — protects the reproducibility commitment and closes the
    // read-then-insert race in ensureActiveDatasetVersion (Task 7).
    uniqueIndex('one_active_dataset_version')
      .on(table.isActive)
      .where(sql`${table.isActive} = true`),
  ],
)

export const question = pgTable(
  'question',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rawText: text('raw_text').notNull(), // immutable: exactly as submitted
    canonicalText: text('canonical_text').notNull(), // current best form (= raw_text at submit)
    embedding: vector('embedding', { dimensions: 768 }),
    embeddingModelVersion: text('embedding_model_version').notNull(),
    datasetVersionId: integer('dataset_version_id')
      .notNull()
      .references(() => datasetVersion.id),
    submitterRef: text('submitter_ref'), // nullable: pseudonymous token or account ref
    visibility: visibilityEnum('visibility').notNull(),
    state: questionStateEnum('state').notNull().default('submitted'),
    tags: text('tags').array(),
    theme: text('theme'),
    clusterId: uuid('cluster_id'), // FK constraint added in Slice 2 when the cluster table exists
    canonicalOf: uuid('canonical_of').references((): AnyPgColumn => question.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // HNSW index for fast cosine-distance nearest-neighbour (dedup + clustering).
    index('question_embedding_hnsw').using('hnsw', table.embedding.op('vector_cosine_ops')),
    index('question_dataset_version_idx').on(table.datasetVersionId),
  ],
)

export type Question = typeof question.$inferSelect
export type NewQuestion = typeof question.$inferInsert
export type DatasetVersion = typeof datasetVersion.$inferSelect
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a file `drizzle/0000_*.sql` containing `CREATE TYPE`, two `CREATE TABLE`, the partial unique index, and the `hnsw` index.

- [ ] **Step 3: Confirm the generated index SQL uses the cosine operator class**

Run: `grep -i hnsw drizzle/0000_*.sql`
Expected: a line of the form `... USING hnsw ("embedding" vector_cosine_ops)`. **If `vector_cosine_ops` is missing**, the index falls back to the default (L2) operator class and cosine queries won't use it — fix the `.op('vector_cosine_ops')` call before continuing.

- [ ] **Step 4: Apply the migration**

Run: `npm run db:migrate`
Expected: migration applies with no error. (The `vector` extension already exists from Task 2.)

- [ ] **Step 5: Verify the tables and vector column width**

Run: `docker compose exec db psql -U qb -d qb -c "\d question" | grep embedding`
Expected: shows `embedding | vector(768)`.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat: add dataset_version and question schema with pgvector"
```

---

## Task 5: Integration-test harness

**Files:**
- Create: `vitest.config.ts`, `tests/setup-integration.ts`

- [ ] **Step 1: Create the test database (one-time)**

Run:
```bash
docker compose exec db psql -U qb -d qb -c "CREATE DATABASE qb_test;"
docker compose exec db psql -U qb -d qb_test -c "CREATE EXTENSION IF NOT EXISTS vector;"
```
Expected: `CREATE DATABASE` then `CREATE EXTENSION`. (Re-running is harmless: ignore "already exists".)

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup-integration.ts'],
  },
})
```

- [ ] **Step 3: Create `tests/setup-integration.ts`**

```ts
import 'dotenv/config'

// Applied to ALL test files. It only redirects DATABASE_URL → TEST_DATABASE_URL, which is a
// no-op for unit tests (they mock fetch and never open the DB) and the safety net for
// integration tests, which must never touch the dev database. src/db/client.ts reads
// DATABASE_URL at import time, so this must run before any DB module is imported — setupFiles do.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
}
```

- [ ] **Step 4: Apply migrations to the test DB**

Run (literal URL — `.env` vars are not exported into the shell):
```bash
DATABASE_URL="postgres://qb:qb@localhost:5432/qb_test" npm run db:migrate
```
Expected: the same tables created in `qb_test`.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts tests/setup-integration.ts
git commit -m "test: add vitest config and integration db harness"
```

---

## Task 6: Ollama client — `embed()` and `getModelDigest()`

**Files:**
- Create: `src/lib/ollama.ts`, `tests/unit/ollama.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/ollama.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { embed, getModelDigest } from '@/lib/ollama'

afterEach(() => vi.restoreAllMocks())

describe('embed', () => {
  it('posts to /api/embed and returns the first embedding vector', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ embeddings: [[0.1, 0.2, 0.3]] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await embed('hello', 'nomic-embed-text')

    expect(result).toEqual([0.1, 0.2, 0.3])
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/api\/embed$/)
    expect(JSON.parse(init.body)).toEqual({ model: 'nomic-embed-text', input: 'hello' })
  })

  it('throws on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })))
    await expect(embed('hi', 'nomic-embed-text')).rejects.toThrow(/Ollama embed failed/)
  })
})

describe('getModelDigest', () => {
  it('returns the digest for the named model from /api/tags', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ models: [{ name: 'nomic-embed-text:latest', digest: 'sha256:abc' }] }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const digest = await getModelDigest('nomic-embed-text')

    expect(digest).toBe('sha256:abc')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/unit/ollama.test.ts`
Expected: FAIL — cannot find module `@/lib/ollama`.

- [ ] **Step 3: Write the implementation**

`src/lib/ollama.ts`:
```ts
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434'

/** Embed a single string with the given model. Returns the raw vector. */
export async function embed(text: string, model: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: text }),
  })
  if (!res.ok) {
    throw new Error(`Ollama embed failed: ${res.status} ${await res.text()}`)
  }
  const data = (await res.json()) as { embeddings: number[][] }
  return data.embeddings[0]
}

/**
 * Resolve a stable provenance identifier for a model: its content digest, via /api/tags.
 * Matches by exact name or the ':latest' suffix. NOTE: a model pulled under an explicit tag
 * (e.g. 'nomic-embed-text:v1.5') must be passed with that full tag, or this throws.
 */
export async function getModelDigest(model: string): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/tags`, { method: 'GET' })
  if (!res.ok) {
    throw new Error(`Ollama tags failed: ${res.status} ${await res.text()}`)
  }
  const data = (await res.json()) as { models: { name: string; digest: string }[] }
  const match = data.models.find((m) => m.name === model || m.name === `${model}:latest`)
  if (!match) {
    throw new Error(`Model not found in Ollama: ${model}`)
  }
  return match.digest
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/unit/ollama.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ollama.ts tests/unit/ollama.test.ts
git commit -m "feat: add ollama embed and model-digest client"
```

---

## Task 7: Active dataset version — read and seed

**Files:**
- Create: `src/lib/dataset-version.ts`, `tests/integration/dataset-version.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/integration/dataset-version.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { ensureActiveDatasetVersion, getActiveDatasetVersion } from '@/lib/dataset-version'
import { datasetVersion } from '@/db/schema'

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ${datasetVersion} RESTART IDENTITY CASCADE`)
})
afterAll(async () => {
  await pool.end()
})

describe('dataset version', () => {
  it('seeds an active version when none exists, then returns it', async () => {
    const created = await ensureActiveDatasetVersion({
      embeddingModel: 'nomic-embed-text',
      embeddingModelDigest: 'sha256:abc',
      embeddingDim: 768,
      dedupThreshold: 0.15,
    })
    expect(created.isActive).toBe(true)
    expect(created.embeddingDim).toBe(768)

    const active = await getActiveDatasetVersion()
    expect(active?.id).toBe(created.id)
  })

  it('does not create a second version if an active one already exists', async () => {
    const cfg = {
      embeddingModel: 'nomic-embed-text',
      embeddingModelDigest: 'sha256:abc',
      embeddingDim: 768,
      dedupThreshold: 0.15,
    }
    const first = await ensureActiveDatasetVersion(cfg)
    const second = await ensureActiveDatasetVersion(cfg)
    expect(second.id).toBe(first.id)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/integration/dataset-version.test.ts`
Expected: FAIL — cannot find module `@/lib/dataset-version`.

- [ ] **Step 3: Write the implementation**

`src/lib/dataset-version.ts`:
```ts
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { datasetVersion, type DatasetVersion } from '@/db/schema'

export interface DatasetVersionConfig {
  embeddingModel: string
  embeddingModelDigest: string
  embeddingDim: number
  dedupThreshold: number
}

/** Return the single active dataset version, or null if none has been seeded. */
export async function getActiveDatasetVersion(): Promise<DatasetVersion | null> {
  const rows = await db
    .select()
    .from(datasetVersion)
    .where(eq(datasetVersion.isActive, true))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Idempotently ensure an active dataset version exists; return it.
 * Concurrent first calls are guarded by the `one_active_dataset_version` partial unique index:
 * the loser's INSERT raises a unique violation, after which the now-existing row is returned.
 */
export async function ensureActiveDatasetVersion(
  config: DatasetVersionConfig,
): Promise<DatasetVersion> {
  const existing = await getActiveDatasetVersion()
  if (existing) return existing

  try {
    const [created] = await db
      .insert(datasetVersion)
      .values({
        embeddingModel: config.embeddingModel,
        embeddingModelDigest: config.embeddingModelDigest,
        embeddingDim: config.embeddingDim,
        dedupThreshold: config.dedupThreshold,
        isActive: true,
      })
      .returning()
    return created
  } catch {
    // Lost a race to another inserter — the active row now exists.
    const active = await getActiveDatasetVersion()
    if (active) return active
    throw new Error('Failed to ensure an active dataset version')
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/integration/dataset-version.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dataset-version.ts tests/integration/dataset-version.test.ts
git commit -m "feat: read and seed the active pinned dataset version"
```

---

## Task 8: Embedding for the active version (provenance)

**Files:**
- Create: `src/lib/embedding.ts`, `tests/unit/embedding.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/embedding.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ollama', () => ({
  embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}))
vi.mock('@/lib/dataset-version', () => ({
  getActiveDatasetVersion: vi.fn().mockResolvedValue({
    id: 1,
    embeddingModel: 'nomic-embed-text',
    embeddingModelDigest: 'sha256:abc',
    embeddingDim: 768,
    dedupThreshold: 0.15,
    isActive: true,
    createdAt: new Date(),
  }),
}))

import { embedForActiveVersion } from '@/lib/embedding'
import { embed } from '@/lib/ollama'

afterEach(() => vi.clearAllMocks())

describe('embedForActiveVersion', () => {
  it('embeds with the active model and stamps the model-version digest', async () => {
    const result = await embedForActiveVersion('what is resilience?')

    expect(embed).toHaveBeenCalledWith('what is resilience?', 'nomic-embed-text')
    expect(result.embedding).toEqual([0.1, 0.2, 0.3])
    expect(result.embeddingModelVersion).toBe('nomic-embed-text@sha256:abc')
    expect(result.datasetVersionId).toBe(1)
    expect(result.dedupThreshold).toBe(0.15)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails (for the RIGHT reason)**

Run: `npm test -- tests/unit/embedding.test.ts`
Expected: FAIL — cannot find module `@/lib/embedding`. If instead you see "embed is not a function"/mock errors, the `vi.mock` hoisting or `@/` alias is misconfigured — fix that (the alias comes from `vitest.config.ts` `resolve.alias`) before writing the implementation.

- [ ] **Step 3: Write the implementation**

`src/lib/embedding.ts`:
```ts
import { embed } from '@/lib/ollama'
import { getActiveDatasetVersion } from '@/lib/dataset-version'

export interface EmbeddingResult {
  embedding: number[]
  /** Provenance: "<model>@<digest>" of the pinned model that produced this vector. */
  embeddingModelVersion: string
  datasetVersionId: number
  dedupThreshold: number
}

/** Embed text using the active pinned model, returning the vector plus provenance. */
export async function embedForActiveVersion(text: string): Promise<EmbeddingResult> {
  const version = await getActiveDatasetVersion()
  if (!version) {
    throw new Error('No active dataset version. Seed one before embedding.')
  }
  const embedding = await embed(text, version.embeddingModel)
  return {
    embedding,
    embeddingModelVersion: `${version.embeddingModel}@${version.embeddingModelDigest}`,
    datasetVersionId: version.id,
    dedupThreshold: version.dedupThreshold,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/unit/embedding.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/embedding.ts tests/unit/embedding.test.ts
git commit -m "feat: embed text for the active version with provenance stamp"
```

---

## Task 9: Dedup-at-source nearest-neighbour query

**Files:**
- Create: `src/lib/dedup.ts`, `tests/integration/dedup.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/integration/dedup.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { datasetVersion, question } from '@/db/schema'
import { findNearest } from '@/lib/dedup'

let versionId: number

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ${question} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${datasetVersion} RESTART IDENTITY CASCADE`)
  const [v] = await db
    .insert(datasetVersion)
    .values({
      embeddingModel: 'nomic-embed-text',
      embeddingModelDigest: 'sha256:test',
      embeddingDim: 768, // matches the real vector(768) column width
      dedupThreshold: 0.15,
    })
    .returning()
  versionId = v.id
})
afterAll(async () => {
  await pool.end()
})

// Helper: pad a small vector to the 768-dim column with zeros. With only a few rows the planner
// uses a seq scan (HNSW recall is exercised only on larger data); these tests assert the cosine
// arithmetic and the filtering/ordering, not index recall.
function pad(vec: number[]): number[] {
  return [...vec, ...Array(768 - vec.length).fill(0)]
}

describe('findNearest', () => {
  it('returns existing questions within the distance threshold, closest first', async () => {
    await db.insert(question).values([
      {
        rawText: 'near', canonicalText: 'near', embedding: pad([1, 0, 0]),
        embeddingModelVersion: 'nomic-embed-text@sha256:test', datasetVersionId: versionId, visibility: 'public',
      },
      {
        rawText: 'far', canonicalText: 'far', embedding: pad([0, 1, 0]),
        embeddingModelVersion: 'nomic-embed-text@sha256:test', datasetVersionId: versionId, visibility: 'public',
      },
    ])

    // Query identical to "near" → distance 0; "far" is orthogonal → distance 1 (above threshold).
    const candidates = await findNearest(pad([1, 0, 0]), versionId, 0.15, 5)

    expect(candidates).toHaveLength(1)
    expect(candidates[0].canonicalText).toBe('near')
    expect(candidates[0].distance).toBeCloseTo(0, 5)
  })

  it('returns an empty array when nothing is within threshold', async () => {
    await db.insert(question).values({
      rawText: 'far', canonicalText: 'far', embedding: pad([0, 1, 0]),
      embeddingModelVersion: 'nomic-embed-text@sha256:test', datasetVersionId: versionId, visibility: 'public',
    })
    const candidates = await findNearest(pad([1, 0, 0]), versionId, 0.15, 5)
    expect(candidates).toEqual([])
  })

  it('only matches within the given dataset version', async () => {
    const [other] = await db
      .insert(datasetVersion)
      .values({
        embeddingModel: 'nomic-embed-text', embeddingModelDigest: 'sha256:test',
        embeddingDim: 768, dedupThreshold: 0.15, isActive: false,
      })
      .returning()
    await db.insert(question).values({
      rawText: 'near-but-other-version', canonicalText: 'near-but-other-version', embedding: pad([1, 0, 0]),
      embeddingModelVersion: 'nomic-embed-text@sha256:test', datasetVersionId: other.id, visibility: 'public',
    })
    const candidates = await findNearest(pad([1, 0, 0]), versionId, 0.15, 5)
    expect(candidates).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/integration/dedup.test.ts`
Expected: FAIL — cannot find module `@/lib/dedup`.

- [ ] **Step 3: Write the implementation**

`src/lib/dedup.ts`:
```ts
import { and, asc, cosineDistance, eq, lt, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { question } from '@/db/schema'

export interface DedupCandidate {
  id: string
  canonicalText: string
  /** Cosine distance from the query (0 = identical, larger = less similar). */
  distance: number
}

/**
 * Find existing questions in the given dataset version whose embedding is within
 * `threshold` cosine distance of `embedding`, closest first. Drives "yours or new?".
 */
export async function findNearest(
  embedding: number[],
  datasetVersionId: number,
  threshold: number,
  limit = 5,
): Promise<DedupCandidate[]> {
  const distance = cosineDistance(question.embedding, embedding)
  return db
    .select({
      id: question.id,
      canonicalText: question.canonicalText,
      distance: sql<number>`${distance}`,
    })
    .from(question)
    .where(and(eq(question.datasetVersionId, datasetVersionId), lt(distance, threshold)))
    .orderBy(asc(distance))
    .limit(limit)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/integration/dedup.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dedup.ts tests/integration/dedup.test.ts
git commit -m "feat: add dedup-at-source nearest-neighbour query"
```

---

## Task 10: Submission orchestration

**Files:**
- Create: `src/lib/submission.ts`, `tests/integration/submission.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/integration/submission.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql, eq } from 'drizzle-orm'

// Embed deterministically without Ollama: map known phrases to fixed padded vectors.
vi.mock('@/lib/ollama', () => ({
  embed: vi.fn(async (text: string) => {
    const base = text.includes('resilience') ? [1, 0, 0] : [0, 1, 0]
    return [...base, ...Array(768 - base.length).fill(0)]
  }),
}))

import { db, pool } from '@/db/client'
import { datasetVersion, question } from '@/db/schema'
import { ensureActiveDatasetVersion } from '@/lib/dataset-version'
import { prepareSubmission, createQuestion } from '@/lib/submission'

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ${question} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${datasetVersion} RESTART IDENTITY CASCADE`)
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

describe('prepareSubmission', () => {
  it('creates a question when no near match exists', async () => {
    const result = await prepareSubmission({ rawText: 'how do we build resilience?', visibility: 'public' })
    expect(result.status).toBe('created')
    expect(result.question?.canonicalText).toBe('how do we build resilience?')

    const rows = await db.select().from(question)
    expect(rows).toHaveLength(1)
    expect(rows[0].state).toBe('submitted')
    expect(rows[0].embeddingModelVersion).toBe('nomic-embed-text@sha256:abc')
  })

  it('returns candidates instead of creating when a near match exists', async () => {
    await prepareSubmission({ rawText: 'how do we build resilience?', visibility: 'public' })
    const result = await prepareSubmission({ rawText: 'resilience: how do we build it?', visibility: 'public' })

    expect(result.status).toBe('candidates')
    expect(result.candidates?.length).toBeGreaterThan(0)
    expect(await db.select().from(question)).toHaveLength(1) // second not auto-inserted
  })
})

describe('createQuestion', () => {
  it('force-creates a new question (submitter chose "new")', async () => {
    await prepareSubmission({ rawText: 'how do we build resilience?', visibility: 'public' })
    const created = await createQuestion({ rawText: 'resilience again', visibility: 'anonymous' })
    expect(created.state).toBe('submitted')
    expect(await db.select().from(question)).toHaveLength(2)
  })

  it('creates a variant linked to the chosen canonical question', async () => {
    const first = await prepareSubmission({ rawText: 'how do we build resilience?', visibility: 'public' })
    const canonicalId = first.question!.id

    const variant = await createQuestion(
      { rawText: 'building resilience?', visibility: 'public' },
      { mergeInto: canonicalId },
    )
    expect(variant.state).toBe('merged_as_variant')
    expect(variant.canonicalOf).toBe(canonicalId)

    const stored = await db.select().from(question).where(eq(question.id, variant.id))
    expect(stored[0].canonicalOf).toBe(canonicalId)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/integration/submission.test.ts`
Expected: FAIL — cannot find module `@/lib/submission`.

- [ ] **Step 3: Write the implementation**

`src/lib/submission.ts`:
```ts
import { db } from '@/db/client'
import { question, type Question } from '@/db/schema'
import { embedForActiveVersion } from '@/lib/embedding'
import { findNearest, type DedupCandidate } from '@/lib/dedup'

export interface SubmitInput {
  rawText: string
  visibility: 'anonymous' | 'public'
  submitterRef?: string | null
}

export interface PrepareResult {
  status: 'created' | 'candidates'
  question?: { id: string; canonicalText: string }
  candidates?: DedupCandidate[]
}

/**
 * Dedup-at-source entry point. Embeds the text, looks for near matches, and either
 * returns candidates ("yours or new?") or — when nothing is close — creates the question.
 */
export async function prepareSubmission(input: SubmitInput): Promise<PrepareResult> {
  const { embedding, embeddingModelVersion, datasetVersionId, dedupThreshold } =
    await embedForActiveVersion(input.rawText)

  const candidates = await findNearest(embedding, datasetVersionId, dedupThreshold)
  if (candidates.length > 0) {
    return { status: 'candidates', candidates }
  }

  const created = await insertQuestion(input, {
    embedding,
    embeddingModelVersion,
    datasetVersionId,
    state: 'submitted',
  })
  return { status: 'created', question: { id: created.id, canonicalText: created.canonicalText } }
}

/**
 * Persist a question after the submitter has decided. With `mergeInto`, store it as a
 * variant of the chosen canonical question; otherwise store it as a fresh submission.
 */
export async function createQuestion(
  input: SubmitInput,
  options: { mergeInto?: string } = {},
): Promise<Question> {
  const { embedding, embeddingModelVersion, datasetVersionId } = await embedForActiveVersion(
    input.rawText,
  )
  return insertQuestion(input, {
    embedding,
    embeddingModelVersion,
    datasetVersionId,
    state: options.mergeInto ? 'merged_as_variant' : 'submitted',
    canonicalOf: options.mergeInto,
  })
}

async function insertQuestion(
  input: SubmitInput,
  fields: {
    embedding: number[]
    embeddingModelVersion: string
    datasetVersionId: number
    state: 'submitted' | 'merged_as_variant'
    canonicalOf?: string
  },
): Promise<Question> {
  const [row] = await db
    .insert(question)
    .values({
      rawText: input.rawText,
      canonicalText: input.rawText, // canonical starts equal to raw; refinements come later
      embedding: fields.embedding,
      embeddingModelVersion: fields.embeddingModelVersion,
      datasetVersionId: fields.datasetVersionId,
      submitterRef: input.submitterRef ?? null,
      visibility: input.visibility,
      state: fields.state,
      canonicalOf: fields.canonicalOf ?? null,
    })
    .returning()
  return row
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/integration/submission.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all unit + integration tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/submission.ts tests/integration/submission.test.ts
git commit -m "feat: add submission orchestration (dedup-at-source + create/variant)"
```

---

## Task 11: Seed the active dataset version (runs before any live submission)

**Files:**
- Create: `scripts/seed-dataset-version.ts`

> Ordered before the API/UI tasks so the manual smoke test and e2e flow have an active dataset version to embed against. Depends only on Tasks 6–7.

- [ ] **Step 1: Create `scripts/seed-dataset-version.ts`**

```ts
import 'dotenv/config'
import { ensureActiveDatasetVersion } from '@/lib/dataset-version'
import { getModelDigest } from '@/lib/ollama'
import { pool } from '@/db/client'

async function main() {
  const model = process.env.EMBEDDING_MODEL ?? 'nomic-embed-text'
  const dim = Number(process.env.EMBEDDING_DIM ?? '768')
  const threshold = Number(process.env.DEDUP_THRESHOLD ?? '0.15')

  const digest = await getModelDigest(model)
  const version = await ensureActiveDatasetVersion({
    embeddingModel: model,
    embeddingModelDigest: digest,
    embeddingDim: dim,
    dedupThreshold: threshold,
  })
  console.log(
    `Active dataset version: id=${version.id} model=${version.embeddingModel} dim=${version.embeddingDim}`,
  )
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

> `tsx` runs this on Node 20 and resolves the `@/` alias from `tsconfig.json` `paths`. The script and its transitive imports (`@/lib/*`, `@/db/client`) all use that alias.

- [ ] **Step 2: Run the seed against the dev DB**

Run (requires `docker compose up` and the model pulled in Task 2): `npm run db:seed`
Expected: prints `Active dataset version: id=1 model=nomic-embed-text dim=768`.
If it errors on resolving `@/...`, confirm `tsconfig.json` has the `"paths"` entry from Task 1 (tsx reads it); as a fallback, switch the script's imports to relative paths.

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-dataset-version.ts
git commit -m "feat: add seed script for the active dataset version"
```

---

## Task 12: API route — `POST /api/questions`

**Files:**
- Create: `src/app/api/questions/route.ts`

- [ ] **Step 1: Write the implementation**

`src/app/api/questions/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { prepareSubmission, createQuestion, type SubmitInput } from '@/lib/submission'

interface RequestBody extends SubmitInput {
  // Submitter's decision after seeing candidates:
  //  - undefined → run dedup-at-source
  //  - { type: 'new' } → force-create a fresh question
  //  - { type: 'merge', canonicalId } → store as a variant of the chosen question
  decision?: { type: 'new' } | { type: 'merge'; canonicalId: string }
}

function isValid(body: unknown): body is RequestBody {
  if (typeof body !== 'object' || body === null) return false
  const b = body as Record<string, unknown>
  if (typeof b.rawText !== 'string' || b.rawText.trim().length === 0) return false
  if (b.visibility !== 'anonymous' && b.visibility !== 'public') return false
  return true
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!isValid(body)) {
    return NextResponse.json(
      { error: 'rawText (non-empty) and visibility ("anonymous" | "public") are required' },
      { status: 400 },
    )
  }

  const input: SubmitInput = {
    rawText: body.rawText.trim(),
    visibility: body.visibility,
    submitterRef: body.submitterRef ?? null,
  }

  try {
    if (body.decision?.type === 'new') {
      const created = await createQuestion(input)
      return NextResponse.json(
        { status: 'created', question: { id: created.id, canonicalText: created.canonicalText } },
        { status: 201 },
      )
    }
    if (body.decision?.type === 'merge') {
      const variant = await createQuestion(input, { mergeInto: body.decision.canonicalId })
      return NextResponse.json(
        { status: 'merged', question: { id: variant.id, canonicalText: variant.canonicalText } },
        { status: 201 },
      )
    }
    const result = await prepareSubmission(input)
    return NextResponse.json(result, { status: result.status === 'created' ? 201 : 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify it type-checks and builds**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; build lists the `/api/questions` route.

- [ ] **Step 3: Manually smoke-test the endpoint** (the active version was seeded in Task 11)

Run:
```bash
npm run dev &
sleep 5
curl -s -X POST http://localhost:3000/api/questions \
  -H 'Content-Type: application/json' \
  -d '{"rawText":"How do we improve UK energy resilience?","visibility":"public"}'
```
Expected: JSON with `"status":"created"` and a question id (first submission), or `"status":"candidates"` if a near match already exists. Stop the dev server afterward (`kill %1`).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/questions/route.ts
git commit -m "feat: add POST /api/questions submit + dedup endpoint"
```

---

## Task 13: Submit page with "yours or new?" UI

**Files:**
- Create: `src/app/submit/page.tsx`

- [ ] **Step 1: Write the implementation**

`src/app/submit/page.tsx`:
```tsx
'use client'

import { useState } from 'react'

interface Candidate {
  id: string
  canonicalText: string
  distance: number
}

type Phase = 'editing' | 'choosing' | 'done'

export default function SubmitPage() {
  const [text, setText] = useState('')
  const [visibility, setVisibility] = useState<'anonymous' | 'public'>('public')
  const [phase, setPhase] = useState<Phase>('editing')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function post(body: Record<string, unknown>) {
    setBusy(true)
    try {
      const res = await fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return await res.json()
    } finally {
      setBusy(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const result = await post({ rawText: text, visibility })
    if (result.status === 'candidates') {
      setCandidates(result.candidates)
      setPhase('choosing')
    } else if (result.status === 'created') {
      setMessage('Thanks — your question was added.')
      setPhase('done')
    } else {
      setMessage(result.error ?? 'Something went wrong.')
    }
  }

  async function chooseNew() {
    const result = await post({ rawText: text, visibility, decision: { type: 'new' } })
    setMessage(result.status === 'created' ? 'Added as a new question.' : (result.error ?? 'Error'))
    setPhase('done')
  }

  async function chooseExisting(canonicalId: string) {
    const result = await post({ rawText: text, visibility, decision: { type: 'merge', canonicalId } })
    setMessage(result.status === 'merged' ? 'Linked to the existing question.' : (result.error ?? 'Error'))
    setPhase('done')
  }

  return (
    <main style={{ maxWidth: 640, margin: '4rem auto', fontFamily: 'system-ui' }}>
      <h1>Submit a question</h1>

      {phase === 'editing' && (
        <form onSubmit={handleSubmit}>
          <textarea
            aria-label="Your question"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            style={{ width: '100%' }}
            required
          />
          <fieldset style={{ marginTop: '0.5rem' }}>
            <legend>Visibility</legend>
            <label>
              <input
                type="radio"
                name="visibility"
                checked={visibility === 'public'}
                onChange={() => setVisibility('public')}
              />{' '}
              Public
            </label>{' '}
            <label>
              <input
                type="radio"
                name="visibility"
                checked={visibility === 'anonymous'}
                onChange={() => setVisibility('anonymous')}
              />{' '}
              Anonymous
            </label>
          </fieldset>
          <button type="submit" disabled={busy || text.trim().length === 0}>
            {busy ? 'Checking…' : 'Submit'}
          </button>
        </form>
      )}

      {phase === 'choosing' && (
        <section>
          <h2>Is your question one of these, or new?</h2>
          <ul>
            {candidates.map((c) => (
              <li key={c.id} style={{ marginBottom: '0.5rem' }}>
                <span>{c.canonicalText}</span>{' '}
                <button type="button" onClick={() => chooseExisting(c.id)} disabled={busy}>
                  This is mine
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={chooseNew} disabled={busy}>
            None of these — mine is new
          </button>
        </section>
      )}

      {phase === 'done' && <p role="status">{message}</p>}
      {phase !== 'done' && message && <p role="alert">{message}</p>}
    </main>
  )
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds, lists `/submit`.

- [ ] **Step 3: Commit**

```bash
git add src/app/submit/page.tsx
git commit -m "feat: add submit page with yours-or-new dedup UI"
```

---

## Task 14: End-to-end submit flow (Playwright)

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/submit.spec.ts`

- [ ] **Step 1: Create `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://localhost:3000' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
```

- [ ] **Step 2: Write the e2e test**

`tests/e2e/submit.spec.ts`:
```ts
import { test, expect } from '@playwright/test'

// Requires: docker compose up, model pulled, and `npm run db:seed` run once (Task 11).
// NOTE: this submits against whatever DB the dev server points to (the DEV db, not qb_test),
// because `reuseExistingServer` may reuse a manually-started server. The unique phrase avoids
// dedup collisions across runs; if this ever returns "candidates" unexpectedly, the dev
// `question` table has accumulated a near match — truncate it.
test('a new question can be submitted', async ({ page }) => {
  const unique = `e2e probe ${Date.now()} — what should councils prioritise for flood defence?`

  await page.goto('/submit')
  await page.getByLabel('Your question').fill(unique)
  await page.getByRole('button', { name: 'Submit' }).click()

  const created = page.getByText('your question was added', { exact: false })
  const chooseNew = page.getByRole('button', { name: 'None of these — mine is new' })

  await expect(created.or(chooseNew)).toBeVisible()
  if (await chooseNew.isVisible()) {
    await chooseNew.click()
  }
  await expect(page.getByRole('status')).toBeVisible()
})
```

- [ ] **Step 3: Run the e2e test**

Run: `npm run test:e2e`
Expected: PASS (1 test).

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts tests/e2e/submit.spec.ts
git commit -m "test: add end-to-end submit flow (playwright)"
```

---

## Task 15: Containerise the app + README run instructions

**Files:**
- Create: `Dockerfile`, `public/.gitkeep`
- Modify: `docker-compose.yml`, `README.md`

- [ ] **Step 1: Create `public/.gitkeep`** (so the Dockerfile `COPY public` succeeds)

Run: `mkdir -p public && touch public/.gitkeep`
Expected: `public/.gitkeep` exists.

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["npm", "start"]
```

- [ ] **Step 3: Add the `app` service to `docker-compose.yml`**

Insert under `services:` (before the `volumes:` block):
```yaml
  app:
    build: .
    environment:
      DATABASE_URL: postgres://qb:qb@db:5432/qb
      OLLAMA_URL: http://ollama:11434
      EMBEDDING_MODEL: nomic-embed-text
      EMBEDDING_DIM: "768"
      DEDUP_THRESHOLD: "0.15"
    ports:
      - "3000:3000"
    depends_on:
      db:
        condition: service_healthy
      ollama:
        condition: service_healthy
```

- [ ] **Step 4: Verify the full stack builds and runs**

Run:
```bash
docker compose build app
docker compose up -d
```
Expected: all three services come up; `http://localhost:3000` serves the home page.

- [ ] **Step 5: Update the README "Getting started" section**

Replace the placeholder block in `README.md` (the `## Getting started` fenced example) with:
````markdown
## Getting started

```bash
docker compose up -d                      # postgres/pgvector + ollama (+ app)
docker compose exec ollama ollama pull nomic-embed-text
npm install
npm run db:migrate                        # create tables
npm run db:seed                           # pin the active dataset version
npm run dev                               # http://localhost:3000
```

Then open `http://localhost:3000/submit` and submit a question. Run the tests with `npm test`
(unit + integration; integration needs the `qb_test` database — see the plan in
`docs/superpowers/plans/`) and `npm run test:e2e`.
````

- [ ] **Step 6: Commit**

```bash
git add Dockerfile docker-compose.yml README.md public/.gitkeep
git commit -m "chore: containerise the app and document the run flow"
```

---

## Final verification

- [ ] **Step 1: Full unit + integration suite passes**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: End-to-end passes**

Run: `npm run test:e2e`
Expected: pass.

- [ ] **Step 3: Lint + typecheck + build clean**

Run: `npm run lint && npx tsc --noEmit && npm run build`
Expected: no errors.

- [ ] **Step 4: Reproducibility spot-check (design commitment)**

Embedding the same text twice against the pinned model yields the same nearest-neighbour result. Run:
```bash
curl -s -X POST http://localhost:3000/api/questions -H 'Content-Type: application/json' \
  -d '{"rawText":"How do we improve UK energy resilience?","visibility":"public"}'
curl -s -X POST http://localhost:3000/api/questions -H 'Content-Type: application/json' \
  -d '{"rawText":"How do we improve UK energy resilience?","visibility":"public"}'
```
Expected: the second call returns `"status":"candidates"` containing the first question — same model, same vector, deterministic match.

- [ ] **Step 5: Update tracking docs**

Mark "Slice 1: Submit + Embed + Dedup-at-source" complete in `PLAN.md` and flip its row to ✅ in `STATE.md`. Commit:
```bash
git add PLAN.md STATE.md
git commit -m "docs: mark Slice 1 (submit/embed/dedup) complete"
```

---

## Self-Review (planner + staff-engineer review applied)

This plan incorporates a staff-engineer review pass. Resolved before execution:
- **Seed runner (Node 20):** uses `tsx` (approved dev dependency); the fragile inline module-loader was removed.
- **Dedup WHERE clause:** uses `lt(cosineDistance(...), threshold)` rather than raw `sql` interpolation.
- **drizzle-orm pinned `^0.45`** so `vector`/`cosineDistance` are present.
- **One-active-version invariant:** enforced by a partial unique index; `ensureActiveDatasetVersion` handles the race.
- **Task ordering:** seed (Task 11) precedes the API smoke test (Task 12) and e2e (Task 14).
- **Test DB migration** uses a literal URL (shell vars from `.env` aren't exported).
- **HNSW operator class** verified in the generated SQL (Task 4 Step 3).
- `public/.gitkeep` and an Ollama healthcheck are explicit steps.

**Spec coverage (slice scope):** Submit (T12/T13) · Embed with pinned model + provenance (T6/T8) · Dedup-at-source "yours or new?" (T9/T10/T13) · model separation/pinning via `dataset_version` (T4/T7/T11) · immutability of `raw_text` (T10). `visibility` + nullable `submitter_ref` are modelled; *unlinkable export* and GDPR tombstones are deferred to the export slice (correctly out of scope here).

**Deferred to later slices/plans (not gaps):** clustering, moderation gate, refinement log, definedness scoring, campaigns/TrueSkill, ranking, synthesis, export/anonymisation, cold-start import. `cluster_id` exists as a nullable column with no FK until Slice 2 adds the `cluster` table.

**Type consistency:** `DedupCandidate`, `EmbeddingResult`, `SubmitInput`, `PrepareResult` each defined once and reused; `findNearest` signature consistent across T9 and its caller T10; `embeddingModelVersion` format `"<model>@<digest>"` consistent in T8, T10, and the tests.
