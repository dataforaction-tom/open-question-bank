# Slice 3 Design — LLM-assisted refinement (the training set)

> Status: **approved design** (2026-06-02). Source of truth for the Slice 3 implementation plan.
> Builds on Slice 2 (Moderation + Clustering). See `question-bank-spec.md` §3, §4, §8, §12 and `definedness-rubric.md`.

## 1. Goal

Turn a `clustered` question into a better-formed one through an LLM-assisted, human-decided refinement — and capture every decision as an append-only `Refinement` row. The append-only refinement log **is the defensible, novel core** of the project (spec §1): an open, versioned training set of question-improvement transformations, produced as a side effect of normal curation.

An admin opens a clustered question, requests a suggestion, and reviews the LLM's proposed rewrite alongside a per-criterion critique against the published definedness rubric. The admin then **accepts**, **edits** (corrects the suggestion, then accepts), or **rejects**. Accepting or editing updates the question's `canonical_text`; every outcome — including rejection — is logged.

This is the refinement stage of the pipeline spine. It does **not** include definedness *scoring*, the `clustered → canonical` curation transition, campaigns, ranking, or synthesis.

## 2. Scope

**In scope**
- Pluggable reasoning-LLM provider: local Ollama (default), Ollama Cloud, and OpenRouter — selected by config, recorded per call.
- On-demand refinement of any `clustered` question (synchronous LLM call, admin-driven — no job queue).
- One suggestion per request: a single rewrite + a structured per-criterion critique + overall rationale.
- Human decision: accept / edit / reject. Accept/edit updates `canonical_text`; edits preserve both the LLM proposal and the human-final text.
- Append-only `refinement` table (the training set).
- Admin refinement surface (list clustered questions → suggest → review → decide) + per-question refinement history (transparency).
- Schema migration `0002`, env additions, tests (unit + integration + e2e).

**Out of scope (later slices / deferred)**
- Definedness *scoring* rows (`DefinednessScore`) — Slice 4.
- `clustered → canonical` curation transition — Slice 4.
- Pure-from-scratch human refinement with no LLM proposal (the edit path already captures human correction of an LLM suggestion; a no-LLM "human writes a new version" flow is deferred).
- Auto-queue / background job runner for bulk refinement (spec §12) — deferred; on-demand only for this slice.
- Live-tested OpenRouter / Ollama Cloud paths — the provider interface is built and unit-tested with mocks; only the local Ollama path is exercised end-to-end.
- Re-embedding on refinement — explicitly **not** done (see Decisions).

## 3. Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Reasoning LLM | **Pluggable provider, local Ollama default** | Spec §3 wants a local, offline-capable default; model is recorded per call so swapping is the intended design point |
| Providers wired | `ollama` (local), `ollama-cloud`, `openrouter` | Local + cloud Ollama share the same `/api/chat` shape (one provider class, parameterised by base URL + optional bearer key); OpenRouter is the separate OpenAI-compatible path |
| Default chat model | **`qwen2.5:7b`** (local Ollama) | Strong instruction-following and reliable structured-JSON output vs `llama3.1:8b` |
| Suggestion shape | **One rewrite + structured per-criterion critique** | One `Refinement` row per suggestion; the critique gives rich training signal (which criteria failed and why) without multiplying rows |
| Eligibility + trigger | **On-demand, any `clustered` question**, synchronous | Matches the existing admin-driven moderation rhythm; no job runner needed this slice |
| Edit capture | **Preserve both `llm_suggested_text` and `after`** | An edit's proposed-vs-corrected delta is the richest training data; a single `after` field would lose it |
| Critique storage | **`critique` jsonb** (per-criterion verdict + note) | Deliberate enrichment beyond the spec's single `rationale` text field, serving the training-set mission directly |
| Re-embedding | **Never on refinement** | Pinned-embedding reproducibility rule (spec §8); embeddings change only at version boundaries. Clustering stays stable even as `canonical_text` evolves |
| State transition | **None in Slice 3** | Curation to `canonical` is Slice 4; refinement operates within the `clustered` state |
| Provenance fallback | `model_version` = digest if available, else model id | `/api/tags` digest works for local Ollama; cloud/OpenRouter models may have no digest |

## 4. Data model (migration `0002`)

The append-only commitment holds: `refinement` rows are never mutated. Corrections are new rows (spec §3).

### `refinement` (new, append-only) — *this is the training set*

| Field | Notes |
|-------|-------|
| `id` | uuid pk, default random |
| `question_id` | uuid fk → `question.id`, not null |
| `before` | text, not null — `canonical_text` at the moment the suggestion was made |
| `llm_suggested_text` | text, nullable — the LLM's proposed rewrite (null for a pure-human row, reserved) |
| `after` | text, nullable — the text actually applied; **null on reject** |
| `criteria_applied` | text[] — which rubric criteria the accepted/suggested edit targeted |
| `critique` | jsonb — array of `{ criterion, verdict: 'pass' \| 'fail', note }` over the five rubric criteria |
| `suggested_by` | enum `refinement_suggested_by` (`llm` \| `human`) |
| `model` | text, nullable — model name (null for human) |
| `model_version` | text, nullable — digest if resolvable, else model id |
| `action` | enum `refinement_action` (`accept` \| `reject` \| `edit`) |
| `actor_ref` | text, not null — who decided (currently `'admin'`, as in Slice 2) |
| `rationale` | text — the LLM's overall stated reasoning (auditable) |
| `timestamp` | timestamptz, not null, default now |

Index: on `question_id` (history is always queried per question).

New enums: `refinement_suggested_by` (`llm`, `human`), `refinement_action` (`accept`, `reject`, `edit`).

**`question` — no schema change.** `canonical_text` already exists and is mutable by design (spec §4: "current best form, updated via accepted refinements"). `raw_text` and `embedding` are untouched.

Mapping to spec §4 `Refinement`: spec's single `after` is split into `llm_suggested_text` + `after`, and `rationale` is supplemented by the structured `critique` jsonb. Both are documented enrichments for training-set fidelity; all spec fields are present.

## 5. Components

- **`src/lib/llm.ts` — reasoning provider layer.**
  - `RefinementProvider` interface: `refine(canonicalText: string): Promise<RefinementSuggestion>`.
  - `RefinementSuggestion`: `{ suggestedText, critique: CriterionCritique[], criteriaApplied: string[], rationale, model, modelVersion }`, validated with **zod** — malformed model output is a hard error, never a silently bad row.
  - `OllamaChatProvider({ baseUrl, apiKey? })`: POSTs `/api/chat` with `format: 'json'`. Used for both **local** (`OLLAMA_URL`, no auth) and **Ollama Cloud** (`https://ollama.com` + bearer `OLLAMA_API_KEY`). Resolves `model_version` via `getModelDigest` when reachable, else falls back to the model id.
  - `OpenRouterProvider({ apiKey, model })`: POSTs the OpenAI-compatible `/chat/completions`; `model_version` = model id.
  - `getProvider()`: reads `REASONING_PROVIDER` (`ollama` | `ollama-cloud` | `openrouter`, default `ollama`) and `REASONING_MODEL` (default `qwen2.5:7b`) and returns the configured provider.
  - **Prompt builder**: embeds the five definedness criteria (kept as a constant mirroring `definedness-rubric.md`) and instructs the model to return JSON — a rewrite, a per-criterion critique, the criteria it targeted, and a rationale.

- **`src/lib/refinement.ts` — orchestration.**
  - `suggestRefinement(questionId)`: eligibility guard (`state === 'clustered'`, else throws a typed error → 409), loads `canonical_text`, calls the provider, returns the (unpersisted) suggestion plus the `before` text.
  - `recordRefinement({ questionId, action, llmSuggestedText, finalText, criteriaApplied, critique, rationale, model, modelVersion, actorRef })`: in **one transaction**, inserts the append-only row and — on `accept`/`edit` — updates `question.canonical_text` to `finalText`. On `reject`, `after` is null and `canonical_text` is unchanged. **No re-embedding, no state change.**

- **API routes** (admin-guarded, reusing the Slice 2 auth/middleware pattern):
  - `POST /api/admin/questions/[id]/refine/suggest` → `suggestRefinement`; returns `{ before, suggestion }`. Not persisted.
  - `POST /api/admin/questions/[id]/refine` → `recordRefinement`; returns the new row.
  - Refinement history is read via the existing question-detail path (extended to include `refinement` rows), not a new public route.

- **Admin UI** — new `/admin/refinement`:
  - Lists `clustered` questions (reuse the admin questions API with a `state` filter).
  - Open a question → **Suggest refinement** → show `before` → `after` diff, the per-criterion critique, and the rationale, with **Accept / Edit / Reject** controls (Edit reveals an editable textarea pre-filled with the suggestion).
  - Loading + error states for the synchronous LLM call. Per-question refinement history listed for transparency.

## 6. Data flow

```
clustered question
  → admin clicks "Suggest refinement"
  → POST .../refine/suggest → provider.refine(canonical_text, rubric)
  → { before, suggestion(suggestedText, critique, criteriaApplied, rationale, model, modelVersion) }
  → admin reviews; chooses Accept | Edit | Reject
  → POST .../refine { action, llmSuggestedText, finalText, ... }
  → append-only refinement row  (+ canonical_text := finalText on accept/edit)
  → history reflects the new row
```

The proposal and the decision are two HTTP calls but one logical transformation, recorded as a single row.

## 7. Error handling

- **LLM unreachable / timeout** → `502`, no row written. (A request timeout is applied to the provider call so a slow local model fails cleanly rather than hanging.)
- **Malformed / non-conforming LLM JSON** → zod validation fails; **one retry**, then surface as `502`; no row.
- **Question not `clustered`** → `409` (typed eligibility error).
- **Question not found** → `404`.
- **Row insert + canonical update** are wrapped in a transaction; a failure rolls both back.
- **Unauthenticated** → handled by existing admin middleware (`302`/`401` per Slice 2).

## 8. Trust note (follow-up, not blocking)

The client carries `llm_suggested_text` back on the decision call, so a tampering client could misrecord what the LLM actually proposed. This is acceptable for the single trusted local admin. For the hosted/multi-user instance, the suggestion should be persisted server-side (e.g. a short-lived `proposed` artifact keyed by id) so the recorded proposal is provably the model's output. Tracked as a deferred follow-up.

## 9. Testing

- **Unit**
  - Prompt builder includes all five rubric criteria.
  - Provider parsing: valid JSON → `RefinementSuggestion`; malformed JSON → throws (mocked `fetch`). Retry-once behaviour.
  - `OllamaChatProvider` sends bearer auth for cloud, none for local; `model_version` digest-vs-id fallback.
  - `recordRefinement`: accept updates `canonical_text` + writes row; reject leaves `canonical_text`, `after` null; edit preserves both `llm_suggested_text` and `after`.
  - Eligibility guard rejects non-`clustered` questions; no re-embed occurs.
- **Integration**
  - Auth-guarded routes (401/302 without session).
  - `suggest` returns a suggestion (provider mocked); `refine` appends a row and updates canonical atomically; append-only (no UPDATE of existing rows).
- **End-to-end** (Playwright, isolated port like Slice 2)
  - Admin logs in → opens a clustered question → Suggest → Edit → Accept → `canonical_text` changed and history shows the row. Provider mocked/stubbed so e2e doesn't depend on a live model.

## 10. Prerequisites

- Pull the default chat model into Ollama: `ollama pull qwen2.5:7b` (confirm before pulling — it adds local resource use).
- Env additions: `REASONING_PROVIDER` (default `ollama`), `REASONING_MODEL` (default `qwen2.5:7b`), `OLLAMA_API_KEY` (cloud), `OPENROUTER_API_KEY` (+ optional `OPENROUTER_MODEL`). `.env.example` updated.
