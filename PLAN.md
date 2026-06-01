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
- [ ] **Resolve the 4 open decisions** below (some block the first migration) — CURRENT
- [ ] Plan the build: data model → migrations → pipeline slices (use plan mode + plan-reviewer)
- [ ] Embedding-model bake-off (`nomic-embed-text` vs `mxbai-embed-large` vs `bge-m3`) — fixes pgvector dimensionality, must precede first migration
- [ ] Scaffold Next.js app + `docker compose` (Ollama + Postgres/pgvector)
- [ ] DB schema + dataset-version-aware migrations (all transformation tables append-only)
- [ ] Slice 1: Submit + Embed + Dedup-at-source ("yours or new?")
- [ ] Slice 2: Cluster (assign-to-nearest within active version) + moderation gate
- [ ] Slice 3: LLM-assisted refinement (the logged transformation = training set)
- [ ] Slice 4: Definedness scoring at curation + admin canonical-set curation
- [ ] Slice 5: Campaigns + pairwise comparison (TrueSkill, adaptive pairing)
- [ ] Slice 6: Ranked agenda + score-evidence transparency views
- [ ] Slice 7: Synthesis (LLM proposes, human endorses, lineage preserved)
- [ ] Open data export + anonymisation/withdrawal (GDPR tombstones)
- [ ] Cold-start: seed question sets + CSV/JSON import

Markers: `[ ]` not started · `[~]` in progress (CURRENT) · `[x]` done · `[!]` blocked

## Decisions Made

| Decision | Rationale | Date |
|----------|-----------|------|
| Local-first stack: Ollama + Postgres/pgvector + Next.js, one docker compose | Zero marginal cost, fully offline-capable, one backend serves self-hosted and hosted; relational data dominates so pgvector beats a vector-first DB (spec §16) | 2026-06-01 |
| Public repo under `dataforaction-tom` org | Open source, work-in-the-open default; matches spec's open/self-hostable framing | 2026-06-01 |
| Use Claude Code template for tracking/workflow | Persistent context, state tracking, self-improving mistakes log across sessions | 2026-06-01 |

## Open Questions

Carried from spec §15 — must be resolved before/around first migration:

- [ ] **Export licence:** CC0 vs ODbL (spec recommends CC0).
- [ ] **Default judging auth:** open+fingerprinted (max participation) vs auth-required (max integrity), as per-campaign default.
- [ ] **Embedding model to pin:** decided by the bake-off; its dimensionality fixes the pgvector column width — blocks the first migration.
- [ ] **Definedness rubric wording:** final published definitions of the five criteria (specific, answerable, scoped, non-leading, single-barrelled) — become part of the open training-set docs.

## Out of Scope (v1)

- Answering questions (MCP/API to find responses) — Phase 2.
- Cross-campaign synthesis.
- Multi-language clustering (single pinned embedding model ⇒ one primary language family per version).
- SQLite/`sqlite-vec` distribution route — considered, deferred (pre-1.0 risk); revisit via libSQL if zero-server distribution proves worth it.
