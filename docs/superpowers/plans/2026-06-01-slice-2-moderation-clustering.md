# Slice 2 (Moderation gate + Clustering + Admin auth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An operator logs into a basic admin surface, reviews `submitted` questions, and approves or rejects each. Approval assigns the question to its nearest cluster within the active dataset version (or forms a new cluster), logs an append-only moderation event, and moves it to `clustered`; rejection moves it to `rejected`.

**Architecture:** Builds on Slice 1. Migration `0001` adds a `cluster` table, a `moderation_event` append-only table, a `cluster_threshold` column on `dataset_version`, and the FK on `question.cluster_id`. Three new `lib` modules — `admin-auth` (stateless signed-cookie session via Web Crypto), `clustering` (assign-to-nearest-representative), `moderation` (approve/reject orchestration). Next middleware guards `/admin/*` and `/api/admin/*`. Admin API + login/moderation UI sit on top.

**Tech Stack:** unchanged from Slice 1 (Next 15, Drizzle `^0.45`, Postgres/pgvector, Vitest, Playwright, tsx). Admin auth uses Web Crypto (`crypto.subtle`) — no new dependency. Design source of truth: `docs/superpowers/specs/2026-06-01-slice-2-moderation-clustering-design.md`.

---

## File Structure

| Path | Responsibility |
|------|----------------|
| `src/db/schema.ts` (modify) | Add `cluster`, `moderation_event`, `moderation_action` enum, `cluster_threshold`, `question.cluster_id` FK |
| `drizzle/0001_*.sql` (generated) | Migration for the above |
| `src/lib/dataset-version.ts` (modify) | Add optional `clusterThreshold` to the config + insert |
| `scripts/seed-dataset-version.ts` (modify) | Pass `CLUSTER_THRESHOLD` |
| `.env.example`, `.env`, `docker-compose.yml` (modify) | `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `CLUSTER_THRESHOLD` |
| `src/lib/admin-auth.ts` | Signed-cookie session: `createSessionToken`, `verifySessionToken`, `checkPassword`, cookie consts |
| `src/lib/clustering.ts` | `assignToNearestCluster(questionId, executor?)` |
| `src/lib/moderation.ts` | `listPending`, `approveQuestion`, `rejectQuestion` |
| `middleware.ts` | Guard `/admin/*` + `/api/admin/*` |
| `src/app/api/admin/login/route.ts` | `POST` login (sets cookie) |
| `src/app/api/admin/logout/route.ts` | `POST` logout (clears cookie) |
| `src/app/api/admin/questions/route.ts` | `GET` pending list |
| `src/app/api/admin/questions/[id]/approve/route.ts` | `POST` approve |
| `src/app/api/admin/questions/[id]/reject/route.ts` | `POST` reject |
| `src/app/admin/login/page.tsx` | Password form |
| `src/app/admin/moderation/page.tsx` | Pending queue UI |
| `tests/unit/admin-auth.test.ts` | Token + password unit tests |
| `tests/integration/clustering.test.ts` | Assign-to-nearest behaviour |
| `tests/integration/moderation.test.ts` | Approve/reject + events + guards |
| `tests/e2e/admin-moderation.spec.ts` | Login → approve flow |
| `playwright.config.ts` (modify) | Load `.env` so tests see `ADMIN_PASSWORD` |

**Conventions:** path alias `@/` → `src/`. Cosine distance throughout. Integration tests run sequentially (`fileParallelism: false`, already set) against `qb_test`.

---

## Task 1: Schema migration `0001`

**Files:** Modify `src/db/schema.ts`; generate `drizzle/0001_*.sql`.

- [ ] **Step 1: Add the `cluster_threshold` column to `datasetVersion`**

In `src/db/schema.ts`, inside the `datasetVersion` column object, add after `dedupThreshold`:
```ts
    clusterThreshold: doublePrecision('cluster_threshold').notNull().default(0.2),
```

- [ ] **Step 2: Add the `moderation_action` enum**

After the existing `questionStateEnum` declaration, add:
```ts
export const moderationActionEnum = pgEnum('moderation_action', ['approve', 'reject'])
```

- [ ] **Step 3: Add the FK on `question.cluster_id`**

Change the existing line in the `question` table from:
```ts
    clusterId: uuid('cluster_id'), // FK constraint added in Slice 2 when the cluster table exists
```
to:
```ts
    clusterId: uuid('cluster_id').references((): AnyPgColumn => cluster.id),
```

- [ ] **Step 4: Add the `cluster` and `moderation_event` tables**

After the `question` table block (and before the `export type` lines), add:
```ts
export const cluster = pgTable(
  'cluster',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    datasetVersionId: integer('dataset_version_id')
      .notNull()
      .references(() => datasetVersion.id),
    representativeQuestionId: uuid('representative_question_id')
      .notNull()
      .references((): AnyPgColumn => question.id),
    thresholdUsed: doublePrecision('threshold_used').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('cluster_dataset_version_idx').on(table.datasetVersionId)],
)

export const moderationEvent = pgTable(
  'moderation_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => question.id),
    action: moderationActionEnum('action').notNull(),
    actorRef: text('actor_ref').notNull(),
    reason: text('reason'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('moderation_event_question_idx').on(table.questionId)],
)
```

- [ ] **Step 5: Add type exports**

After the existing `export type` lines, add:
```ts
export type Cluster = typeof cluster.$inferSelect
export type ModerationEvent = typeof moderationEvent.$inferSelect
```

- [ ] **Step 6: Generate the migration**

Run: `npm run db:generate`
Expected: `drizzle/0001_*.sql` is created containing the new enum, the `cluster_threshold` column, both new tables, and the FK constraints (including the circular `cluster`↔`question` constraints as `ALTER TABLE ... ADD CONSTRAINT`).

- [ ] **Step 7: Apply to dev and test databases**

Run:
```bash
npm run db:migrate
DATABASE_URL="postgres://qb:qb@localhost:5432/qb_test" npm run db:migrate
```
Expected: both apply with no error. (Docker note: `db:migrate` connects directly to localhost; no `docker compose exec` needed. If you DO use `docker compose exec`, prefix with `DOCKER_CONFIG=/tmp/docker-noauth`.)

- [ ] **Step 8: Verify the new tables exist and the FK on cluster_id is present**

Run: `docker compose exec db psql -U qb -d qb -c "\d question" | grep cluster_id && docker compose exec db psql -U qb -d qb -c "\dt"`
Expected: `cluster_id` shows a foreign-key reference to `cluster`, and `\dt` lists `cluster` and `moderation_event` alongside `dataset_version` and `question`. (Prefix with `DOCKER_CONFIG=/tmp/docker-noauth` if the keychain error appears.)

- [ ] **Step 9: Confirm existing tests still pass and typecheck is clean**

Run: `npx tsc --noEmit && npm test`
Expected: tsc exit 0; all 13 existing tests still pass (the schema additions don't break Slice 1).

- [ ] **Step 10: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat: add cluster, moderation_event, and cluster_threshold schema"
```

---

## Task 2: Configuration — env vars, seed, compose

**Files:** Modify `.env.example`, `.env` (local), `docker-compose.yml`, `src/lib/dataset-version.ts`, `scripts/seed-dataset-version.ts`.

- [ ] **Step 1: Add env vars to `.env.example`**

Append to `.env.example`:
```bash

# Clustering (Slice 2): max cosine distance to join an existing cluster
CLUSTER_THRESHOLD=0.2

# Admin auth (Slice 2)
ADMIN_PASSWORD=change-me
ADMIN_SESSION_SECRET=change-me-to-a-long-random-string
```

- [ ] **Step 2: Add the same to local `.env` with working dev values**

Append to `.env` (gitignored — local only):
```bash
CLUSTER_THRESHOLD=0.2
ADMIN_PASSWORD=admin
ADMIN_SESSION_SECRET=dev-only-secret-do-not-use-in-prod-0123456789
```

- [ ] **Step 3: Make `clusterThreshold` an optional part of the dataset-version config**

In `src/lib/dataset-version.ts`, add to the `DatasetVersionConfig` interface:
```ts
  clusterThreshold?: number
```
And in `ensureActiveDatasetVersion`'s `.values({...})`, add (Drizzle omits `undefined`, so the DB default `0.2` applies when not provided — keeps Slice 1 callers working):
```ts
      clusterThreshold: config.clusterThreshold,
```

- [ ] **Step 4: Pass `CLUSTER_THRESHOLD` from the seed script**

In `scripts/seed-dataset-version.ts`, after the existing `threshold` line add:
```ts
  const clusterThreshold = Number(process.env.CLUSTER_THRESHOLD ?? '0.2')
```
and add `clusterThreshold,` to the `ensureActiveDatasetVersion({...})` call.

- [ ] **Step 5: Add admin + clustering env to the compose `app` service**

In `docker-compose.yml`, under the `app` service `environment:` block, add:
```yaml
      CLUSTER_THRESHOLD: "0.2"
      ADMIN_PASSWORD: admin
      ADMIN_SESSION_SECRET: dev-only-secret-do-not-use-in-prod-0123456789
```

- [ ] **Step 6: Verify typecheck + existing tests**

Run: `npx tsc --noEmit && npm test`
Expected: tsc exit 0; 13 tests still pass.

- [ ] **Step 7: Commit**

```bash
git add .env.example docker-compose.yml src/lib/dataset-version.ts scripts/seed-dataset-version.ts
git commit -m "chore: add clustering + admin env config and seed cluster_threshold"
```

---

## Task 3: Admin auth library

**Files:** Create `src/lib/admin-auth.ts`, `tests/unit/admin-auth.test.ts`. TDD.

- [ ] **Step 1: Write the failing test** — `tests/unit/admin-auth.test.ts`:
```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { checkPassword, createSessionToken, verifySessionToken } from '@/lib/admin-auth'

beforeAll(() => {
  process.env.ADMIN_PASSWORD = 'hunter2'
  process.env.ADMIN_SESSION_SECRET = 'test-secret-long-enough-0123456789'
})

describe('session tokens', () => {
  it('verifies a freshly issued token', async () => {
    const token = await createSessionToken()
    expect(await verifySessionToken(token)).toBe(true)
  })

  it('rejects a tampered token', async () => {
    const token = await createSessionToken()
    const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a')
    expect(await verifySessionToken(tampered)).toBe(false)
  })

  it('rejects an expired token', async () => {
    const expired = await createSessionToken(-10) // exp 10s in the past
    expect(await verifySessionToken(expired)).toBe(false)
  })

  it('rejects undefined / malformed tokens', async () => {
    expect(await verifySessionToken(undefined)).toBe(false)
    expect(await verifySessionToken('not-a-token')).toBe(false)
  })
})

describe('checkPassword', () => {
  it('accepts the configured password and rejects others', () => {
    expect(checkPassword('hunter2')).toBe(true)
    expect(checkPassword('wrong')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**: `npm test -- tests/unit/admin-auth.test.ts`
Expected: FAIL — cannot find module `@/lib/admin-auth`.

- [ ] **Step 3: Write the implementation** — `src/lib/admin-auth.ts`:
```ts
// Stateless admin session over an HMAC-signed cookie. Uses Web Crypto (crypto.subtle) and
// btoa/atob only, so the same code runs in Node route handlers AND the Edge middleware.

const encoder = new TextEncoder()
const SESSION_TTL_SECONDS = 12 * 60 * 60

export const SESSION_COOKIE = 'qb_admin_session'

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
    secure: process.env.NODE_ENV === 'production',
  }
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function getSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET
  if (!secret) throw new Error('ADMIN_SESSION_SECRET is not set')
  return secret
}

async function sign(payloadB64: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64))
  return bytesToB64url(new Uint8Array(sig))
}

/** Issue a signed session token. ttlSeconds is overridable for tests. */
export async function createSessionToken(ttlSeconds: number = SESSION_TTL_SECONDS): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const payload = { iat: now, exp: now + ttlSeconds }
  const payloadB64 = bytesToB64url(encoder.encode(JSON.stringify(payload)))
  const sig = await sign(payloadB64)
  return `${payloadB64}.${sig}`
}

/** Verify a session token's signature and expiry. */
export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [payloadB64, sig] = parts
  const expected = await sign(payloadB64)
  if (!constantTimeEqual(sig, expected)) return false
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64))) as { exp?: number }
    return typeof payload.exp === 'number' && payload.exp > Math.floor(Date.now() / 1000)
  } catch {
    return false
  }
}

/** Constant-time compare of a candidate password to ADMIN_PASSWORD. */
export function checkPassword(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD
  if (!expected) throw new Error('ADMIN_PASSWORD is not set')
  return constantTimeEqual(candidate, expected)
}
```

- [ ] **Step 4: Run the test to verify it passes**: `npm test -- tests/unit/admin-auth.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin-auth.ts tests/unit/admin-auth.test.ts
git commit -m "feat: add admin auth (signed-cookie session via web crypto)"
```

---

## Task 4: Middleware + login/logout routes

**Files:** Create `middleware.ts` (repo root), `src/app/api/admin/login/route.ts`, `src/app/api/admin/logout/route.ts`.

- [ ] **Step 1: Create `middleware.ts`** (repo root, next to `package.json`):
```ts
import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/admin-auth'

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Login endpoints must be reachable without a session.
  if (pathname === '/admin/login' || pathname === '/api/admin/login') {
    return NextResponse.next()
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (await verifySessionToken(token)) {
    return NextResponse.next()
  }

  if (pathname.startsWith('/api/admin')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const loginUrl = req.nextUrl.clone()
  loginUrl.pathname = '/admin/login'
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
}
```

- [ ] **Step 2: Create `src/app/api/admin/login/route.ts`**:
```ts
import { NextResponse } from 'next/server'
import { checkPassword, createSessionToken, SESSION_COOKIE, sessionCookieOptions } from '@/lib/admin-auth'

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const password = (body as { password?: unknown }).password
  if (typeof password !== 'string' || !checkPassword(password)) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }
  const token = await createSessionToken()
  const res = NextResponse.json({ status: 'ok' })
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions())
  return res
}
```

- [ ] **Step 3: Create `src/app/api/admin/logout/route.ts`**:
```ts
import { NextResponse } from 'next/server'
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/admin-auth'

export async function POST() {
  const res = NextResponse.json({ status: 'ok' })
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 })
  return res
}
```

- [ ] **Step 4: Build and typecheck**: `npx tsc --noEmit && npm run build`
Expected: no errors; the build lists `/api/admin/login` and `/api/admin/logout` and reports middleware.

- [ ] **Step 5: Smoke-test auth against the dev server**

Run (ensure nothing else holds port 3000; the seed already ran in Slice 1):
```bash
npm run dev & sleep 5
echo "--- protected route without cookie (expect 401) ---"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/admin/questions?state=submitted
echo "--- login with wrong password (expect 401) ---"
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/admin/login -H 'Content-Type: application/json' -d '{"password":"wrong"}'
echo "--- login with correct password (expect 200) + capture cookie ---"
curl -s -c /tmp/qbcookies -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/admin/login -H 'Content-Type: application/json' -d '{"password":"admin"}'
echo "--- protected route WITH cookie (expect 200) ---"
curl -s -b /tmp/qbcookies -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/admin/questions?state=submitted
pkill -f "next dev"
```
Expected: `401`, `401`, `200`, `200` in order. (The 4th hits `/api/admin/questions`, which is created in Task 6 — if that route doesn't exist yet, you'll get `404` WITH the cookie instead of `401`, which still proves auth passed. Re-run this smoke test after Task 6 to confirm `200`.) Confirm no `next dev` lingers.

- [ ] **Step 6: Commit**

```bash
git add middleware.ts src/app/api/admin/login/route.ts src/app/api/admin/logout/route.ts
git commit -m "feat: add admin auth middleware and login/logout routes"
```

---

## Task 5: Clustering library

**Files:** Create `src/lib/clustering.ts`, `tests/integration/clustering.test.ts`. TDD.

- [ ] **Step 1: Write the failing test** — `tests/integration/clustering.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { cluster, datasetVersion, question } from '@/db/schema'
import { assignToNearestCluster } from '@/lib/clustering'

let versionId: number

function pad(vec: number[]): number[] {
  return [...vec, ...Array(768 - vec.length).fill(0)]
}

async function insertQuestion(text: string, vec: number[], dvId = versionId): Promise<string> {
  const [row] = await db
    .insert(question)
    .values({
      rawText: text,
      canonicalText: text,
      embedding: pad(vec),
      embeddingModelVersion: 'test@sha256:test',
      datasetVersionId: dvId,
      visibility: 'public',
    })
    .returning()
  return row.id
}

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ${cluster} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${question} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${datasetVersion} RESTART IDENTITY CASCADE`)
  const [v] = await db
    .insert(datasetVersion)
    .values({
      embeddingModel: 'test',
      embeddingModelDigest: 'sha256:test',
      embeddingDim: 768,
      dedupThreshold: 0.15,
      clusterThreshold: 0.3,
    })
    .returning()
  versionId = v.id
})
afterAll(async () => {
  await pool.end()
})

describe('assignToNearestCluster', () => {
  it('forms a new cluster for the first question', async () => {
    const q1 = await insertQuestion('first', [1, 0, 0])
    const result = await assignToNearestCluster(q1)
    expect(result.created).toBe(true)

    const clusters = await db.select().from(cluster)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].representativeQuestionId).toBe(q1)
    const [stored] = await db.select().from(question).where(eq(question.id, q1))
    expect(stored.clusterId).toBe(result.clusterId)
  })

  it('joins a near question to the existing cluster', async () => {
    const q1 = await insertQuestion('first', [1, 0, 0])
    const r1 = await assignToNearestCluster(q1)
    const q2 = await insertQuestion('near', [0.9, 0.1, 0]) // cosine distance ~0.006 < 0.3
    const r2 = await assignToNearestCluster(q2)

    expect(r2.created).toBe(false)
    expect(r2.clusterId).toBe(r1.clusterId)
    expect(await db.select().from(cluster)).toHaveLength(1)
  })

  it('forms a new cluster for a far question', async () => {
    const q1 = await insertQuestion('first', [1, 0, 0])
    await assignToNearestCluster(q1)
    const q2 = await insertQuestion('far', [0, 1, 0]) // distance 1.0 > 0.3
    const r2 = await assignToNearestCluster(q2)

    expect(r2.created).toBe(true)
    expect(await db.select().from(cluster)).toHaveLength(2)
  })

  it('never joins a cluster from a different dataset version', async () => {
    const [other] = await db
      .insert(datasetVersion)
      .values({
        embeddingModel: 'test',
        embeddingModelDigest: 'sha256:test',
        embeddingDim: 768,
        dedupThreshold: 0.15,
        clusterThreshold: 0.3,
        isActive: false,
      })
      .returning()
    const otherQ = await insertQuestion('other-version', [1, 0, 0], other.id)
    await assignToNearestCluster(otherQ) // forms a cluster in the other version

    const q1 = await insertQuestion('active-version', [1, 0, 0])
    const r1 = await assignToNearestCluster(q1)
    expect(r1.created).toBe(true) // did NOT join the other version's identical-vector cluster

    const [stored] = await db.select().from(cluster).where(eq(cluster.id, r1.clusterId))
    expect(stored.datasetVersionId).toBe(versionId)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**: `npm test -- tests/integration/clustering.test.ts`
Expected: FAIL — cannot find module `@/lib/clustering`.

- [ ] **Step 3: Write the implementation** — `src/lib/clustering.ts`:
```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**: `npm test -- tests/integration/clustering.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/clustering.ts tests/integration/clustering.test.ts
git commit -m "feat: add assign-to-nearest clustering"
```

---

## Task 6: Moderation library + admin questions API

**Files:** Create `src/lib/moderation.ts`, `tests/integration/moderation.test.ts`, `src/app/api/admin/questions/route.ts`, `src/app/api/admin/questions/[id]/approve/route.ts`, `src/app/api/admin/questions/[id]/reject/route.ts`. TDD for the lib.

- [ ] **Step 1: Write the failing test** — `tests/integration/moderation.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '@/db/client'
import { cluster, datasetVersion, moderationEvent, question } from '@/db/schema'
import { approveQuestion, listPending, rejectQuestion } from '@/lib/moderation'

let versionId: number

function pad(vec: number[]): number[] {
  return [...vec, ...Array(768 - vec.length).fill(0)]
}

async function insertSubmitted(text: string, vec: number[]): Promise<string> {
  const [row] = await db
    .insert(question)
    .values({
      rawText: text,
      canonicalText: text,
      embedding: pad(vec),
      embeddingModelVersion: 'test@sha256:test',
      datasetVersionId: versionId,
      visibility: 'public',
      state: 'submitted',
    })
    .returning()
  return row.id
}

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ${moderationEvent} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${cluster} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${question} RESTART IDENTITY CASCADE`)
  await db.execute(sql`TRUNCATE TABLE ${datasetVersion} RESTART IDENTITY CASCADE`)
  const [v] = await db
    .insert(datasetVersion)
    .values({
      embeddingModel: 'test',
      embeddingModelDigest: 'sha256:test',
      embeddingDim: 768,
      dedupThreshold: 0.15,
      clusterThreshold: 0.3,
    })
    .returning()
  versionId = v.id
})
afterAll(async () => {
  await pool.end()
})

describe('listPending', () => {
  it('returns only submitted questions, oldest first', async () => {
    await insertSubmitted('a', [1, 0, 0])
    await insertSubmitted('b', [0, 1, 0])
    const pending = await listPending()
    expect(pending.map((p) => p.canonicalText)).toEqual(['a', 'b'])
  })
})

describe('approveQuestion', () => {
  it('clusters the question, logs an event, and sets state=clustered', async () => {
    const id = await insertSubmitted('q', [1, 0, 0])
    const result = await approveQuestion(id, 'admin')
    expect(result.created).toBe(true)

    const [q] = await db.select().from(question).where(eq(question.id, id))
    expect(q.state).toBe('clustered')
    expect(q.clusterId).toBe(result.clusterId)

    const events = await db.select().from(moderationEvent).where(eq(moderationEvent.questionId, id))
    expect(events).toHaveLength(1)
    expect(events[0].action).toBe('approve')
    expect(events[0].actorRef).toBe('admin')
  })

  it('refuses to approve a question that is not submitted', async () => {
    const id = await insertSubmitted('q', [1, 0, 0])
    await approveQuestion(id, 'admin')
    await expect(approveQuestion(id, 'admin')).rejects.toThrow(/not pending/)
    const events = await db.select().from(moderationEvent).where(eq(moderationEvent.questionId, id))
    expect(events).toHaveLength(1) // no second event written
  })
})

describe('rejectQuestion', () => {
  it('sets state=rejected and logs an event with the reason', async () => {
    const id = await insertSubmitted('spam', [1, 0, 0])
    await rejectQuestion(id, 'admin', 'off-topic')

    const [q] = await db.select().from(question).where(eq(question.id, id))
    expect(q.state).toBe('rejected')
    expect(q.clusterId).toBeNull()

    const events = await db.select().from(moderationEvent).where(eq(moderationEvent.questionId, id))
    expect(events).toHaveLength(1)
    expect(events[0].action).toBe('reject')
    expect(events[0].reason).toBe('off-topic')
  })

  it('refuses to reject a non-submitted question', async () => {
    const id = await insertSubmitted('q', [1, 0, 0])
    await rejectQuestion(id, 'admin')
    await expect(rejectQuestion(id, 'admin')).rejects.toThrow(/not pending/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**: `npm test -- tests/integration/moderation.test.ts`
Expected: FAIL — cannot find module `@/lib/moderation`.

- [ ] **Step 3: Write the implementation** — `src/lib/moderation.ts`:
```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**: `npm test -- tests/integration/moderation.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Create the admin questions list route** — `src/app/api/admin/questions/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { listPending } from '@/lib/moderation'

export async function GET(request: Request) {
  const state = new URL(request.url).searchParams.get('state') ?? 'submitted'
  if (state !== 'submitted') {
    return NextResponse.json({ error: 'Only state=submitted is supported' }, { status: 400 })
  }
  const questions = await listPending()
  return NextResponse.json({ questions })
}
```

- [ ] **Step 6: Create the approve route** — `src/app/api/admin/questions/[id]/approve/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { approveQuestion } from '@/lib/moderation'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const result = await approveQuestion(id, 'admin')
    return NextResponse.json({ status: 'clustered', ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (/not found/.test(message)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (/not pending/.test(message)) return NextResponse.json({ error: 'Not pending' }, { status: 409 })
    console.error('[POST /api/admin/questions/:id/approve]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 7: Create the reject route** — `src/app/api/admin/questions/[id]/reject/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { rejectQuestion } from '@/lib/moderation'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let reason: string | undefined
  try {
    const body = (await request.json()) as { reason?: unknown }
    if (typeof body.reason === 'string') reason = body.reason
  } catch {
    // no body is fine
  }
  try {
    await rejectQuestion(id, 'admin', reason)
    return NextResponse.json({ status: 'rejected' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (/not found/.test(message)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (/not pending/.test(message)) return NextResponse.json({ error: 'Not pending' }, { status: 409 })
    console.error('[POST /api/admin/questions/:id/reject]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 8: Typecheck, build, and run the full suite**

Run: `npx tsc --noEmit && npm run build && npm test`
Expected: tsc clean; build lists `/api/admin/questions` and the `[id]/approve` + `[id]/reject` dynamic routes; all tests pass (13 from Slice 1 + 5 admin-auth + 4 clustering + 5 moderation = 27).

- [ ] **Step 9: Commit**

```bash
git add src/lib/moderation.ts tests/integration/moderation.test.ts src/app/api/admin/questions
git commit -m "feat: add moderation lib and admin questions API"
```

---

## Task 7: Admin UI — login + moderation queue

**Files:** Create `src/app/admin/login/page.tsx`, `src/app/admin/moderation/page.tsx`.

- [ ] **Step 1: Create the login page** — `src/app/admin/login/page.tsx`:
```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function AdminLoginPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        router.push('/admin/moderation')
      } else {
        setError('Invalid password.')
      }
    } catch {
      setError('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ maxWidth: 360, margin: '4rem auto', fontFamily: 'system-ui' }}>
      <h1>Admin login</h1>
      <form onSubmit={handleSubmit}>
        <label>
          Password{' '}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>{' '}
        <button type="submit" disabled={busy || password.length === 0}>
          {busy ? 'Signing in…' : 'Log in'}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </main>
  )
}
```

- [ ] **Step 2: Create the moderation queue page** — `src/app/admin/moderation/page.tsx`:
```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

interface Pending {
  id: string
  canonicalText: string
  createdAt: string
}

export default function ModerationPage() {
  const router = useRouter()
  const [pending, setPending] = useState<Pending[]>([])
  const [message, setMessage] = useState('')
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/questions?state=submitted')
    if (res.ok) {
      const data = await res.json()
      setPending(data.questions)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function approve(id: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/questions/${id}/approve`, { method: 'POST' })
      const data = await res.json()
      setMessage(
        res.ok
          ? data.created
            ? 'Approved — formed a new cluster.'
            : 'Approved — joined an existing cluster.'
          : (data.error ?? 'Error'),
      )
    } catch {
      setMessage('Network error — please try again.')
    } finally {
      setBusyId(null)
      load()
    }
  }

  async function reject(id: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/questions/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reasons[id] ?? '' }),
      })
      const data = await res.json()
      setMessage(res.ok ? 'Rejected.' : (data.error ?? 'Error'))
    } catch {
      setMessage('Network error — please try again.')
    } finally {
      setBusyId(null)
      load()
    }
  }

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' })
    router.push('/admin/login')
  }

  return (
    <main style={{ maxWidth: 720, margin: '4rem auto', fontFamily: 'system-ui' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h1>Moderation queue</h1>
        <button type="button" onClick={logout}>
          Log out
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      {pending.length === 0 ? (
        <p>No pending questions.</p>
      ) : (
        <ul>
          {pending.map((q) => (
            <li key={q.id} style={{ marginBottom: '1rem' }}>
              <div>{q.canonicalText}</div>
              <button type="button" onClick={() => approve(q.id)} disabled={busyId === q.id}>
                Approve
              </button>{' '}
              <input
                aria-label={`Reject reason for ${q.id}`}
                placeholder="reason (optional)"
                value={reasons[q.id] ?? ''}
                onChange={(e) => setReasons((r) => ({ ...r, [q.id]: e.target.value }))}
              />{' '}
              <button type="button" onClick={() => reject(q.id)} disabled={busyId === q.id}>
                Reject
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
```

- [ ] **Step 3: Build and lint**: `npm run build && npm run lint`
Expected: build lists `/admin/login` and `/admin/moderation`; lint clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin
git commit -m "feat: add admin login and moderation queue UI"
```

---

## Task 8: End-to-end admin moderation flow (Playwright)

**Files:** Modify `playwright.config.ts`; create `tests/e2e/admin-moderation.spec.ts`.

- [ ] **Step 1: Load `.env` in the Playwright config** so tests can read `ADMIN_PASSWORD`

In `playwright.config.ts`, add as the very first line:
```ts
import 'dotenv/config'
```
(Leave the rest of the config unchanged.)

- [ ] **Step 2: Write the e2e test** — `tests/e2e/admin-moderation.spec.ts`:
```ts
import { test, expect } from '@playwright/test'

// Requires: docker stack up, model pulled, db seeded, and ADMIN_PASSWORD/ADMIN_SESSION_SECRET in .env.
test('admin logs in and approves a pending question', async ({ page, request }) => {
  const password = process.env.ADMIN_PASSWORD ?? 'admin'
  const unique = `e2e moderation ${Date.now()} — what should councils prioritise for coastal erosion?`

  // Create a pending submission via the public API (force "new" so it lands as submitted).
  const created = await request.post('/api/questions', {
    data: { rawText: unique, visibility: 'public', decision: { type: 'new' } },
  })
  expect(created.ok()).toBeTruthy()

  // Unauthenticated moderation page redirects to login.
  await page.goto('/admin/moderation')
  await expect(page).toHaveURL(/\/admin\/login/)

  // Log in.
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /log in/i }).click()
  await expect(page).toHaveURL(/\/admin\/moderation/)

  // Our question is in the queue; approve it.
  const row = page.locator('li', { hasText: unique })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Approve' }).click()

  // Cluster confirmation appears.
  await expect(page.getByRole('status')).toContainText(/cluster/i)
})
```

- [ ] **Step 3: Run the e2e suite**: `npm run test:e2e`
Expected: PASS (2 tests — the Slice 1 submit test and this one). Ensure no stale `next dev` holds port 3000 first (`pkill -f "next dev"` if needed; Playwright starts its own server).

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts tests/e2e/admin-moderation.spec.ts
git commit -m "test: add end-to-end admin moderation flow"
```

---

## Task 9: Final verification + docs

**Files:** Modify `PLAN.md`, `STATE.md`.

- [ ] **Step 1: Full unit + integration suite**: `npm test`
Expected: 27 tests pass (13 + 5 + 4 + 5).

- [ ] **Step 2: E2e**: `npm run test:e2e`
Expected: 2 tests pass.

- [ ] **Step 3: Lint + typecheck + build**: `npm run lint && npx tsc --noEmit && npm run build`
Expected: clean; build lists the admin routes/pages and middleware.

- [ ] **Step 4: Rebuild and run the containerised stack** (the app image must pick up middleware + new routes + env)

Run:
```bash
docker compose up -d --build
sleep 5
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/admin/questions?state=submitted   # expect 401 (no cookie)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/admin/login                            # expect 200
```
Expected: `401` then `200`. (Prefix docker commands with `DOCKER_CONFIG=/tmp/docker-noauth` if the keychain error appears.)

- [ ] **Step 5: Update tracking docs**

In `PLAN.md`, change the Slice 2 task line to `[x]` and move the CURRENT marker to Slice 3. In `STATE.md`, flip the "Cluster + moderation gate" row to ✅ Done with a note, and add admin-auth to the component list if appropriate. Commit:
```bash
git add PLAN.md STATE.md
git commit -m "docs: mark Slice 2 (moderation + clustering) complete"
```

---

## Self-Review (planner)

**Spec coverage:** admin auth (T3/T4) · moderation gate submitted→{clustered|rejected} (T6) · assign-to-nearest clustering with new-cluster-beyond-threshold + version isolation (T5) · per-version `cluster_threshold` (T1/T2) · append-only `moderation_event` (T1/T6) · admin queue UI (T7) · e2e (T8). Matches the design doc.

**Placeholder scan:** none — every step has full code or an exact command + expected output.

**Type consistency:** `assignToNearestCluster(questionId, executor?)` signature is consistent between T5 and its caller in T6 (`approveQuestion` passes `tx`). The `Executor` type derives the tx type from `db.transaction` so no fragile internal imports. `listPending` shape (`{id, canonicalText, createdAt}`) matches the moderation page's `Pending` interface (T7). Route error→status mapping (`not found`→404, `not pending`→409) matches the messages thrown by `moderation.ts`.

**Ordering / dependencies:** migration (T1) → config+seed (T2) → auth lib (T3) → middleware+login (T4) → clustering (T5) → moderation+API (T6) → UI (T7) → e2e (T8) → verify+docs (T9). The Task 4 auth smoke test notes that `/api/admin/questions` arrives in T6 (re-check returns 200 after T6). Migration applied to both `qb` and `qb_test` in T1 so integration tests (T5/T6) have the tables.

**Carried risk:** circular `cluster`↔`question` FK — handled by Drizzle generating `ALTER TABLE ADD CONSTRAINT` and by the runtime order (question pre-exists, `cluster_id` nullable); verified in T1 Step 8.
