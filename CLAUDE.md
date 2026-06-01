# Project: Question Bank

A collective intelligence and prioritisation tool for questions. It takes a messy pool of submitted questions and produces a trustworthy, prioritised, synthesised agenda — every transformation logged, versioned, and open. Open source and local-first (self-hostable on a single machine), with an optional hosted instance. Prioritisation is the product; answering questions is out of scope for v1.

The defensible core is the **refinement log**: every LLM-assisted improvement to a question is captured as an append-only transformation record, building an open, versioned training set as a side effect of normal use.

## Design commitments (non-negotiable)

- **Transparency** — every ranking, grouping, and refinement is explainable and auditable. No black boxes.
- **Reproducibility** — the embedding model is pinned per dataset version; re-clustering happens only at version boundaries. Rankings never silently shift.
- **Provenance** — every record carries the model, model version, actor, and timestamp that produced it. All transformation tables are append-only; corrections are new rows, never edits.
- **Openness** — data is exportable under a defined licence; anonymous submissions are genuinely *unlinkable* (tokens stripped/rotated, not just name-removed).

## Stack (local-first)

The whole system runs on one machine (target: Mac mini M4) with no required external dependency, via a single `docker compose` stack:

- **Ollama** — serves BOTH the pinned embedding model AND the default reasoning LLM. Two roles, one server.
- **Postgres + pgvector** — single store for all relational/audit tables AND embedding vectors. No separate vector DB.
- **App (Next.js, TypeScript)** — submit flow, front end, admin panel, API.
- **OpenRouter** *(optional)* — remote reasoning LLM for synthesis only, if an operator wants a frontier model. A config bonus, never a requirement.

### Model separation (critical — never conflate these two roles)

- **Embedding model**: clustering, dedup, similarity. Chosen once at first boot, **pinned per dataset version**. Its output dimensionality fixes the pgvector column width. Changing it requires an explicit re-embed migration that mints a new `dataset_version` — warn hard on any change attempt.
- **Reasoning LLM**: refinement suggestions, definedness scoring, synthesis proposals. Freely swappable per call. Only ever *proposes* — humans accept. Recorded on every record it produces.

## Architecture

Not yet scaffolded — see PLAN.md. Intended shape (Next.js app router):
- `app/` — routes (submit flow, campaign pages, per-question detail, admin)
- `lib/` — pipeline logic (embed, dedup, cluster, refine, score, TrueSkill, synthesis), Ollama + db clients
- `db/` — schema + migrations (dataset-version aware)
- `docker-compose.yml` — Ollama + Postgres/pgvector + app

The pipeline IS the product; dashboards are a read layer on top:
`Submit → Embed → Dedup-at-source → Cluster → LLM refinement → Definedness scoring → Curate canonical set → Pairwise prioritisation (TrueSkill, adaptive pairing) → Ranked agenda → Synthesis (LLM proposes, human endorses)`

## Commands

Project not scaffolded yet. Conventions for once it is:
- `npm run dev` — start development server
- `npm test` — run tests
- `npm run build` — production build
- `npm run lint` — check for issues
- `docker compose up` — bring up Ollama + Postgres/pgvector + app

## Standards

- TypeScript, Next.js app router. Readability over cleverness; comment the *why*.
- Transformation tables are append-only — model corrections as new rows.
- Every record produced by a model stores `model`, `model_version`, `actor_ref`, `timestamp`.
- Anonymisation is designed in from the schema, not retrofitted.
- Write tests for pipeline logic (embedding/dedup/TrueSkill/lineage are correctness-critical).
- Don't add dependencies without asking.

## Verification

- Run `npm run build` after structural changes.
- Run `npm run lint` before considering a task complete.
- Run `npm test` after changes to tested code.
- For pipeline changes, verify reproducibility: same dataset version + same pinned model ⇒ same clusters.

## Working Rules

- Always check for existing patterns before creating new ones.
- Prefer small, incremental changes over big rewrites.
- If a task will take more than ~50 lines of changes, use plan mode first.
- Don't refactor code that wasn't part of the task.
- Don't create files without explaining what and why.
- Work on branches, not directly on main.

## State & Progress

> Updated: 2026-06-01
> Current focus: Repo + template scaffolding complete. Planning the build before writing app code.
> Status: Pre-build. Spec finalised (question-bank-spec.md). Stack decided (local-first). App not yet scaffolded.

See PLAN.md for task tracking, STATE.md for system state, HANDOFF.md for session notes.

## Known Issues

- None yet — nothing built.

## Lessons Learned

Things to not repeat on this project — highest-leverage section, add to it as mistakes happen:

- (none yet)

<!--
Keep this file concise. ~150 instructions max before Claude starts ignoring things.
Focus on: things Claude gets wrong, patterns it can't infer, commands it needs.
-->
