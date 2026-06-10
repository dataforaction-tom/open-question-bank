# Slice 4 Design — Definedness scoring + canonical curation

> Status: **approved design** (2026-06-10). Source of truth for the Slice 4 implementation plan.
> Builds on Slice 3 (LLM-assisted refinement). See `question-bank-spec.md` §4, §5 and `definedness-rubric.md`.

## 1. Goal

Give the admin a model-produced, fully auditable **definedness assessment** of a clustered question — five criteria, each scored 1–5 with a rationale — and the power to promote the question from `clustered` to `canonical`. Scoring is **advisory**: it informs the promotion decision but never gates it. The human stays in control.

Each scoring run persists five append-only `definedness_score` rows (one per criterion) carrying `model`, `model_version`, and `timestamp` (spec §4). Like the refinement log, this is open training-set data produced as a side effect of normal curation: a versioned record of how models judge question quality over time.

This slice covers the **Score → Curate** stages of the pipeline spine. It does **not** include campaigns, pairwise comparison, ranking, or synthesis.

## 2. Scope

**In scope**
- `DefinednessScore` data model: append-only `definedness_score` table, migration `0003`.
- Provider refactor: extract the retry/validate/version loop from `ChatProvider.refine()` into a generic `complete(prompt, schema)` core; add `score()` alongside `refine()`.
- LLM scoring contract: exactly five `{ criterion, score 1–5, rationale }` entries, zod-validated; prompt built from the published rubric with explicit 1–5 anchors.
- On-demand scoring of any `clustered` question (synchronous, admin-driven — same rhythm as refinement). Re-scoring appends new rows.
- `clustered → canonical` promotion with an audit row (`moderation_event` gains action `promote`).
- New curation lib (`src/lib/curation.ts`), three admin API routes, and a new `/admin/curation` page.
- Tests (unit + integration + e2e with the deterministic mock provider).

**Out of scope (later slices / deferred)**
- Using scores as a hard promotion gate or threshold — explicitly rejected (decision below).
- Auto-scoring on promote, bulk/background scoring — on-demand only, as with refinement.
- Human-entered scores — scoring is model-produced by definition (spec §4); there is no human-scoring path to reserve.
- Campaigns, `under_comparison`, TrueSkill — Slice 5.
- Demoting `canonical` back to `clustered` — no reverse transition this slice; a mistaken promotion is rare for a single trusted admin and can be revisited when curation matures.

## 3. Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Score scale | **1–5 ordinal integer + rationale per criterion** | Graded signal for borderline curation calls; richer open-training-set data than pass/fail |
| Scoring × promotion | **Score first, then promote — advisory, never a gate** | Admin triggers scoring, reads the breakdown, decides freely. Promote works with zero scores on record. Not auto-triggered by promote |
| Provider shape | **Generic `complete(prompt, zodSchema)` core** | One retry/validate/version-resolution loop shared by `refine()` and `score()`; transport subclasses untouched |
| Score vs critique | **Distinct artifacts** | Slice 3's per-criterion `critique` (pass/fail) is advisory context *during rewriting*; `definedness_score` is a persisted, model-versioned assessment *at curation* (spec §4). Not a rename |
| Run grouping | **No `run_id` column** | All five rows of a run insert in one transaction, so `now()` stamps them identically — history groups by `(timestamp, model_version)` for free. YAGNI |
| Score provenance | **`model` / `model_version` NOT NULL** | Unlike `refinement` (nullable for the reserved pure-human path), a score is always model-produced |
| Promotion audit | **`moderation_event` row, new action `promote`** | Every other state transition is audited; one enum value beats a new `curation_event` table the existing columns already cover |
| Current-score semantics | **Latest row per criterion** | Append-only: re-scoring adds rows, never edits. The "current" view is derived, not stored |
| Score range integrity | **DB `CHECK (score BETWEEN 1 AND 5)`** | Belt-and-braces under the zod boundary validation — bad data can't land even via a future non-zod write path |

## 4. Data model (migration `0003`)

### `definedness_score` (new, append-only)

| Field | Notes |
|-------|-------|
| `id` | uuid pk, default random |
| `question_id` | uuid fk → `question.id`, not null |
| `criterion` | enum `definedness_criterion` (`specific` \| `answerable` \| `scoped` \| `non-leading` \| `single-barrelled`), not null |
| `score` | integer, not null, `CHECK (score BETWEEN 1 AND 5)` |
| `rationale` | text, not null — the model's stated reasoning for this criterion's score |
| `model` | text, not null |
| `model_version` | text, not null — digest if resolvable, else model id (same fallback as Slice 3) |
| `timestamp` | timestamptz, not null, default now |

Index: on `question_id` (history is always queried per question).

New enum: `definedness_criterion` (the five rubric criteria — mirrors the `CRITERIA` constant in `src/lib/llm.ts`).

One scoring run = five rows inserted in **one transaction**; they share an identical `now()` timestamp, which is how the UI groups runs. Rows are never mutated; re-scoring appends five more.

### `moderation_event` — enum extension

`moderation_action` gains a third value: `promote` (alongside `approve`, `reject`). A promotion appends `{ question_id, action: 'promote', actor_ref, timestamp }`. No table-shape change.

### `question` — no schema change

Promotion flips `state` from `clustered` to `canonical` (a value declared in the enum since Slice 1). `canonical_text`, `embedding`, and everything else are untouched — **no re-embedding** (spec §8).

## 5. Components

- **`src/lib/llm.ts` — provider refactor + scoring.**
  - `ChatProvider` gains a protected generic `complete<T>(prompt, schema: ZodType<T>): Promise<T & { model, modelVersion }>` containing the existing retry-once / zod-validate / resolve-model-version loop, moved verbatim from `refine()`. Transport subclasses (`OllamaChatProvider`, `OpenRouterProvider`) are untouched.
  - The public interface is renamed `RefinementProvider` → `ReasoningProvider` with two methods; `refine()` and the new `score()` each become a thin wrapper: build prompt → `complete(prompt, schema)`. Behaviour of `refine()` is unchanged — all existing tests stay green modulo the rename.
  - **Scoring contract** (`scoreResultSchema`): `{ scores: [{ criterion, score: int 1–5, rationale: non-empty string }] }`, exactly five entries, each criterion present exactly once (zod `.length(5)` + a refinement asserting the criterion set).
  - **Scoring prompt**: built from the full rubric — each criterion's definition *and* fails-when guidance (richer than the condensed `RUBRIC` block refinement uses), with explicit anchors: 1 = clearly fails the criterion, 5 = clearly satisfies it.
  - `MockProvider.score()` is deterministic (fixed scores + fixed rationales) so e2e asserts exact UI content, mirroring `refine()`'s `"(refined)"` convention.
- **`src/lib/errors.ts` — shared typed errors.** `NotFoundError` / `IneligibleError` move here from `refinement.ts` (re-exported there so existing imports keep working); `curation.ts` uses the same pair.
- **`src/lib/curation.ts` — orchestration (new module; curation is its own pipeline stage, one-module-per-stage like `refinement.ts`).**
  - `scoreQuestion(questionId, provider?)`: guard `state === 'clustered'` (else `IneligibleError`; missing → `NotFoundError`), call `provider.score(canonical_text)`, insert the five rows in one transaction, return them. Never touches state; repeatable.
  - `listScores(questionId)`: full history, oldest first; throws `NotFoundError` for an unknown question (deliberately stricter than Slice 3's `listRefinements`, which returns `[]` — that papercut is not copied).
  - `promoteToCanonical(questionId, actorRef)`: in one transaction — guard `state === 'clustered'`, set `state = 'canonical'`, append the `promote` audit row. **No scoring precondition.**
- **API routes** (admin-guarded; existing error mapping: `NotFoundError` → 404, `IneligibleError` → 409, `ProviderError` → 502):
  - `POST /api/admin/questions/[id]/score` → `scoreQuestion`; persists and returns the five rows. No request body. (No `actor_ref` on scores — they are model-attributed per spec §4; the human act this slice audits is promotion, which records `actor_ref = 'admin'` as in Slices 2–3.)
  - `GET /api/admin/questions/[id]/scores` → `{ current, history }` where `current` is the derived latest-row-per-criterion view; 404 for an unknown question.
  - `POST /api/admin/questions/[id]/promote` → `promoteToCanonical`; returns the updated question; 409 if not `clustered`.
- **Admin UI** — new `/admin/curation` (one-page-per-stage, like moderation and refinement):
  - Lists `clustered` questions (reuses `listClustered`).
  - Per question: **Score** → 1–5 breakdown per criterion with rationales + an average as a glanceable summary; **Promote** always available, with scores alongside as advisory context. Re-score allowed; prior runs visible (grouped by run timestamp), echoing the refinement page's history pattern.
  - Promoted questions drop off the list (no longer `clustered`). Loading + error states for the synchronous LLM call, as on the refinement page.

## 6. Data flow

```
clustered question
  → admin clicks "Score"
  → POST .../score → provider.score(canonical_text)   [complete(prompt, scoreResultSchema)]
  → five definedness_score rows (one tx, shared timestamp, model + model_version)
  → admin reads breakdown + rationales (advisory)
  → admin clicks "Promote" (with or without scores)
  → POST .../promote → state := canonical + moderation_event(action='promote')   [one tx]
  → question leaves the curation list
```

Scoring and promotion are independent actions on the same page — two calls, two artifacts, no coupling.

## 7. Error handling

- **LLM unreachable / timeout / malformed output** → retry once, then `ProviderError` → `502`; **no rows written** (insert happens only after validation passes).
- **Question not found** → `404` (all three routes, including the GET).
- **Question not `clustered`** → `409` (score and promote).
- **Partial scoring run impossible** — the five inserts share a transaction; a failure rolls all back.
- **Double promote** → second call finds `state = 'canonical'` → `409`; the transaction guard re-checks state, so concurrent promotes can't double-append audit rows.
- **Unauthenticated** → existing admin middleware (`302`/`401`).

## 8. Testing

- **Unit**
  - `complete()` refactor: existing provider tests stay green (rename aside) — proves behaviour-preservation for `refine()`.
  - Scoring contract: valid payload parses; malformed JSON / missing criterion / duplicate criterion / out-of-range score → retry once → `ProviderError`.
  - Scoring prompt includes all five criteria and the 1–5 anchors.
  - `MockProvider.score()` determinism.
- **Integration** (`qb_test`)
  - `scoreQuestion`: five rows, one shared timestamp, correct provenance; guard rejects non-`clustered`; provider failure writes nothing.
  - `promoteToCanonical`: state flips + audit row in one transaction; 409 on re-promote; promote with zero scores succeeds.
  - Latest-per-criterion derivation after two scoring runs.
  - Route status mapping (404 / 409 / 502 / auth guard) for all three routes.
- **End-to-end** (Playwright, `REASONING_PROVIDER=mock`, port 3100)
  - Login → `/admin/curation` → score a clustered question → deterministic breakdown renders → promote → question leaves the list; state verified `canonical`.

## 9. Prerequisites

- No new env vars, no new dependencies — reuses the Slice 3 provider config (`REASONING_PROVIDER`, `REASONING_MODEL`).
- Live (non-mock) scoring in dev needs `qwen2.5:7b` pulled into Ollama (`ollama pull qwen2.5:7b` — ask first; same prerequisite Slice 3 documented and deferred).
- `qb_test` gets migration `0003` via the normal migration run.
