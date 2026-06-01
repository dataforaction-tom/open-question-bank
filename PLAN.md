# Plan

> Last updated: 2026-06-01
> Status: In progress — pre-build (repo + scaffolding docs set up, app not yet started)

## Objective

Build the Question Bank: a local-first, open-source tool that turns a messy pool of submitted questions into a trustworthy, prioritised, synthesised agenda — with every transformation (refinement, comparison, synthesis, scoring) logged in append-only tables. v1 is a prioritisation instrument; answering questions is Phase 2 and out of scope. The novel core is the open, versioned **refinement training set** produced as a side effect.

See `question-bank-spec.md` for the full technical specification (the source of truth).

## Approach

Local-first single-machine stack, one `docker compose`:
- **Ollama** serves the pinned embedding model and the default reasoning LLM.
- **Postgres + pgvector** stores all relational/audit data and the embedding vectors (no separate vector DB).
- **Next.js** app for submit flow, front end, admin panel, API.
- **OpenRouter** optional, remote reasoning for synthesis only.

Build along the pipeline spine, slice by slice, each slice runnable and tested before the next:
`Submit → Embed → Dedup-at-source → Cluster → Refine → Score → Curate → Compare (TrueSkill) → Rank → Synthesise`.

## Tasks

- [x] Pull Claude Code template into repo
- [x] Customise tracking docs (CLAUDE.md / PLAN.md / STATE.md / README.md) from spec
- [x] Create + push public repo `dataforaction-tom/open-question-bank`
- [x] **Resolve the 4 open decisions** below (CC0 · open+fingerprinted · pin `nomic-embed-text` (768-dim) · rubric in `definedness-rubric.md`)
- [x] Plan the build: data model → migrations → pipeline slices (plan in `docs/superpowers/plans/`, staff-reviewed)
- [ ] Embedding-model bake-off (`nomic-embed-text` vs `mxbai-embed-large` vs `bge-m3`) — `nomic-embed-text` pinned as default; bake-off confirms before final migration
- [x] Scaffold Next.js app + `docker compose` (Ollama + Postgres/pgvector)
- [x] DB schema + dataset-version-aware migrations (`dataset_version`, `question`; pgvector `vector(768)` + HNSW cosine; one-active-version invariant)
- [x] Slice 1: Submit + Embed + Dedup-at-source ("yours or new?") — full pipeline tested (13 unit/integration + e2e), endpoint hardened per review
- [ ] Slice 2: Cluster (assign-to-nearest within active version) + moderation gate — CURRENT
- [ ] Slice 3: LLM-assisted refinement (the logged transformation = training set)
- [ ] Slice 4: Definedness scoring at curation + admin canonical-set curation
- [ ] Slice 5: Campaigns + pairwise comparison (TrueSkill, adaptive pairing)
- [ ] Slice 6: Ranked agenda + score-evidence transparency views
- [ ] Slice 7: Synthesis (LLM proposes, human endorses, lineage preserved)
- [ ] Open data export + anonymisation/withdrawal (GDPR tombstones)
- [ ] Cold-start: seed question sets + CSV/JSON import

Markers: `[ ]` not started · `[~]` in progress (CURRENT) · `[x]` done · `[!]` blocked

### Slice 1 follow-ups (deferred from review — address in/around Slice 2)

- **Double embedding on decision:** `prepareSubmission` embeds, then if the submitter picks "new"/"merge" the API re-embeds the same text in `createQuestion`. Deterministic (same model/text) but doubles Ollama work — carry the vector through (opaque token) or cache it server-side when clustering lands.
- **Dedup matches variants:** `findNearest` has no `state` filter, so a `merged_as_variant` row can surface as a candidate. Add a state filter (with a test) when Slice 2 reshapes dedup/clustering.

## Decisions Made

| Decision | Rationale | Date |
|----------|-----------|------|
| Local-first stack: Ollama + Postgres/pgvector + Next.js, one docker compose | Zero marginal cost, fully offline-capable, one backend serves self-hosted and hosted; relational data dominates so pgvector beats a vector-first DB (spec §16) | 2026-06-01 |
| Public repo under `dataforaction-tom` org | Open source, work-in-the-open default; matches spec's open/self-hostable framing | 2026-06-01 |
| Use Claude Code template for tracking/workflow | Persistent context, state tracking, self-improving mistakes log across sessions | 2026-06-01 |
| **Export licence: CC0** | Maximally open, frictionless downstream analysis — matches the transparency mission (spec §11 recommendation) | 2026-06-01 |
| **Default judging auth: open + fingerprinted** | Maximises participation on an open instance; vote provenance made visible rather than pretending manipulation is impossible. Per-campaign override to auth-required remains (spec §6) | 2026-06-01 |
| **Pin `nomic-embed-text` (768-dim)** | Sensible default for short, direct questions; **768 fixes the pgvector column width**. Bake-off vs `mxbai-embed-large`/`bge-m3` still runs to confirm before the first real migration (spec §16) | 2026-06-01 |
| **Definedness rubric: 5 criteria defined** | `specific` (concreteness), `answerable`, `scoped` (boundedness), `non-leading`, `single-barrelled` (one ask) — split specific/scoped as concreteness vs boundedness to keep them non-overlapping. See `definedness-rubric.md` | 2026-06-01 |

## Open Questions

Carried from spec §15 — **all four resolved 2026-06-01** (see Decisions Made above):

- [x] **Export licence:** **CC0**.
- [x] **Default judging auth:** **open + fingerprinted** (per-campaign override to auth-required retained).
- [x] **Embedding model to pin:** **`nomic-embed-text`** (768-dim → pgvector column width). Bake-off still confirms before final migration.
- [x] **Definedness rubric wording:** five criteria defined in `definedness-rubric.md`.

## Out of Scope (v1)

- Answering questions (MCP/API to find responses) — Phase 2.
- Cross-campaign synthesis.
- Multi-language clustering (single pinned embedding model ⇒ one primary language family per version).
- SQLite/`sqlite-vec` distribution route — considered, deferred (pre-1.0 risk); revisit via libSQL if zero-server distribution proves worth it.
