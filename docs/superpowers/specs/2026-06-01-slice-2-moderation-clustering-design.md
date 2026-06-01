# Slice 2 Design — Moderation gate + Clustering + Admin auth

> Status: **approved design** (2026-06-01). Source of truth for the Slice 2 implementation plan.
> Builds on Slice 1 (Submit → Embed → Dedup-at-source). See `question-bank-spec.md` §4, §5, §8.

## 1. Goal

Turn the open pool of `submitted` questions into a moderated, clustered set. An operator logs into a basic admin surface, reviews pending submissions, and approves or rejects each. On approval, the question is assigned to its nearest existing cluster within the active dataset version (or forms a new cluster if beyond the cluster threshold) and moves to `clustered`. Rejected questions move to `rejected`. Every moderation decision is logged in an append-only audit table.

This is the curation stage of the pipeline spine. It does **not** include refinement, definedness scoring, campaigns, or any later stage.

## 2. Scope

**In scope**
- Basic admin authentication (password → signed-cookie session) protecting all admin surfaces.
- Manual moderation queue: list pending submissions, approve/reject (with optional reason).
- Clustering: assign-to-nearest-representative within the active dataset version; form a new cluster when beyond `cluster_threshold` (spec §5, §8).
- Append-only `moderation_event` audit log.
- Schema migration `0001`, env additions, tests (unit + integration + e2e).

**Out of scope (later slices)** — refinement log (Slice 3), definedness scoring (Slice 4), campaigns/TrueSkill (Slice 5), ranking (Slice 6), synthesis (Slice 7), export/anonymisation, full re-clustering at version boundaries (spec §8 — version-boundary migrations are a separate concern), auto-flagging of suspicious submissions (`flagged` state reserved but unused), production-grade auth/SSO (Clerk arrives with the hosted instance).

## 3. Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Clustering strategy | Assign-to-nearest **representative**; new cluster beyond threshold | Matches spec §5/§8 "assign-to-nearest within active version"; cheap pgvector query; no per-insert centroid churn |
| Cluster trigger | On moderation **approval** only | Only vetted questions enter clusters; spec §5 ordering `submitted → clustered` |
| Cluster threshold source | Per-`dataset_version` column `cluster_threshold` | Versioned + reproducible; recorded per cluster as `threshold_used` (spec §4) |
| Admin auth | Stateless **signed-cookie** session, password from env | No new dependency, no session table, works in Next middleware (Web Crypto) |
| Moderation audit | Append-only `moderation_event` table | Consistent with the project's transparency/provenance commitments |
| Default `cluster_threshold` | `0.2` (cosine distance) | Broader than dedup's `0.15`; tunable per version |

## 4. Data model (migration `0001`)

All additions are dataset-version-aware. The append-only commitment holds: `moderation_event` rows are never mutated.

### `dataset_version` (alter)
- Add `cluster_threshold double precision NOT NULL DEFAULT 0.2` — cosine distance ceiling for joining an existing cluster. The existing active row (id=1, from Slice 1) picks up the default automatically.

### `cluster` (new)
| Field | Notes |
|-------|-------|
| `id` | uuid pk, default random |
| `dataset_version_id` | int fk → `dataset_version.id`, not null |
| `representative_question_id` | uuid fk → `question.id`, not null — the question that anchors the cluster (the first member; nearest-distance is measured against it) |
| `threshold_used` | double, not null — the `cluster_threshold` in force when the cluster formed (published, not hidden — spec §4) |
| `created_at` | timestamptz, default now |

Index: on `dataset_version_id` (clusters are always queried within a version).

### `question` (alter)
- Add the FK constraint on the existing nullable `cluster_id` column → `cluster.id`. Membership is modelled here (one cluster per question), not as a denormalised array on `cluster`.

### `moderation_event` (new, append-only)
| Field | Notes |
|-------|-------|
| `id` | uuid pk, default random |
| `question_id` | uuid fk → `question.id`, not null |
| `action` | enum `moderation_action` (`approve` \| `reject`) |
| `actor_ref` | text, not null — admin identifier (the literal `"admin"` for the single shared account in this slice) |
| `reason` | text, nullable — optional note (esp. for rejections) |
| `timestamp` | timestamptz, default now |

Index: on `question_id`.

### Migration / FK ordering note
`cluster.representative_question_id → question.id` and `question.cluster_id → cluster.id` form a circular FK. This is safe because: (a) `question.cluster_id` is nullable, and (b) at cluster-creation time the representative question already exists (it was inserted in Slice 1 and is merely being approved). Order of operations on approval: question exists with `cluster_id = NULL` → insert `cluster` referencing it → update `question.cluster_id`. The migration creates both tables then adds the constraints; no chicken-and-egg insert occurs at runtime.

### State transitions (question)
```
submitted ──approve──► clustered   (assigned a cluster_id)
          └─reject───► rejected
```
Approving or rejecting a question not in `submitted` is an error (idempotency guard — prevents double-moderation).

## 5. Components

### `src/lib/admin-auth.ts`
Stateless session over an HMAC-signed cookie, using **Web Crypto** (`crypto.subtle`) so the same code runs in the Node route handlers and the Edge middleware. No new dependency.
- `createSessionToken(): Promise<string>` — payload `{ iat, exp }` (exp = iat + 12h), token = `base64url(payload).base64url(HMAC_SHA256(ADMIN_SESSION_SECRET, payload))`.
- `verifySessionToken(token): Promise<boolean>` — recompute HMAC (constant-time compare), check `exp` not passed.
- `checkPassword(candidate): boolean` — constant-time compare to `ADMIN_PASSWORD`.
- `SESSION_COOKIE = 'qb_admin_session'`; cookie options: `httpOnly`, `sameSite: 'lax'`, `path: '/'`, `maxAge: 12h`, `secure` in production.

### `src/lib/clustering.ts`
- `assignToNearestCluster(questionId): Promise<{ clusterId: string; created: boolean }>`
  1. Load the question (embedding, `dataset_version_id`).
  2. Find the nearest cluster in that version: join `cluster` → its `representative_question`, order by `cosineDistance(representative.embedding, question.embedding)` asc, limit 1.
  3. If a nearest exists and its distance `< dataset_version.cluster_threshold` → set `question.cluster_id` to it; `created = false`.
  4. Otherwise → insert a new `cluster` (`representative_question_id = questionId`, `threshold_used = cluster_threshold`), set `question.cluster_id` to it; `created = true`.
  Runs inside a transaction so the cluster insert + question update are atomic.

### `src/lib/moderation.ts`
- `listPending(limit?): Promise<{ id, canonicalText, createdAt }[]>` — questions in `submitted`, oldest first.
- `approveQuestion(id, actorRef): Promise<{ clusterId, created }>` — guard state is `submitted`; insert `moderation_event(approve)`; call `assignToNearestCluster`; set `state = 'clustered'`. Transactional.
- `rejectQuestion(id, actorRef, reason?): Promise<void>` — guard state is `submitted`; insert `moderation_event(reject)`; set `state = 'rejected'`. Transactional.

### `middleware.ts` (repo root)
Matcher: `/admin/:path*` and `/api/admin/:path*`, excluding `/admin/login` and `/api/admin/login`. Reads `SESSION_COOKIE`, verifies via `verifySessionToken`. On failure: page routes → 307 redirect to `/admin/login`; API routes → `401 { error: 'Unauthorized' }`.

### API routes (all under `/api/admin`, protected by middleware except login)
- `POST /api/admin/login` — `{ password }`; on `checkPassword` success, set the session cookie; 200. On failure, 401 (no detail).
- `POST /api/admin/logout` — clear the cookie; 200.
- `GET /api/admin/questions?state=submitted` — pending list (only `submitted` supported in this slice).
- `POST /api/admin/questions/[id]/approve` — `approveQuestion`; returns `{ status: 'clustered', clusterId, created }`. 404 if not found; 409 if not in `submitted`.
- `POST /api/admin/questions/[id]/reject` — `{ reason? }`; `rejectQuestion`; returns `{ status: 'rejected' }`. 404/409 as above.

### UI
- `/admin/login` — password form → `POST /api/admin/login` → redirect to `/admin/moderation`.
- `/admin/moderation` — fetches the pending list; each row shows `canonicalText` with **Approve** and **Reject** (reject reveals an optional reason field). On approve, surfaces whether it joined an existing cluster or formed a new one (transparency). Empty state when the queue is clear. A logout link.

## 6. Configuration

New env vars (added to `.env.example` and the compose `app` service):
- `ADMIN_PASSWORD` — the shared admin password (required for admin login).
- `ADMIN_SESSION_SECRET` — HMAC key for session tokens (required; long random string).
- `CLUSTER_THRESHOLD=0.2` — used by the seed script when minting a dataset version.

The seed script (`scripts/seed-dataset-version.ts`) sets `cluster_threshold` on newly-minted versions. The existing version row keeps the migration default unless re-seeded into a new version.

## 7. Testing

- **Unit** (`tests/unit/admin-auth.test.ts`): token round-trips (sign → verify true); tampered token rejected; expired token rejected; `checkPassword` true/false. No DB/network.
- **Integration** (`tests/integration/clustering.test.ts`): first approved question forms a cluster (`created=true`, becomes representative); a near question joins it (`created=false`, distance `< threshold`); a far question forms a new cluster; clusters never cross dataset versions. (`tests/integration/moderation.test.ts`): approve → `clustered`, `cluster_id` set, one `moderation_event(approve)`; reject → `rejected`, one `moderation_event(reject)`; approving/rejecting a non-`submitted` question throws and writes no event.
- **e2e** (`tests/e2e/admin-moderation.spec.ts`, with `ADMIN_PASSWORD`/`ADMIN_SESSION_SECRET` set): unauthenticated `/admin/moderation` redirects to login; after login, a seeded pending question appears; approving it shows the cluster confirmation and clears it from the queue.

Integration tests run sequentially (existing `fileParallelism: false`) against `qb_test`, which receives migration `0001`.

## 8. Risks & notes

- **Representative drift:** anchoring clusters to their first member (not a recomputed centroid) means cluster shape depends on submission order. Acceptable for assign-to-nearest within a version; full re-clustering at version boundaries (spec §8, later) is where centroids/quality get revisited.
- **Edge runtime crypto:** middleware uses Web Crypto (`crypto.subtle`), available in the Edge runtime; `node:crypto` is intentionally avoided there.
- **Auth scope:** a single shared password is "basic" by design — adequate for a local/single-operator instance, not a hostile public surface. Real multi-user auth lands with the hosted instance.
- **Double-embedding (carried from Slice 1):** unaffected here; still tracked as a Slice 1 follow-up in `PLAN.md`.
