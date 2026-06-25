# Question Bank

**A collective intelligence and prioritisation tool for questions.**

Question Bank takes a messy pool of submitted questions and produces a trustworthy, prioritised, synthesised agenda — with every transformation logged, versioned, and open. It is a **prioritisation instrument first**; answering questions is an explicit later phase, out of scope for v1.

Open source and **local-first**: the whole system runs on a single machine with no required external dependency. A hosted instance is offered too, on the same backend.

> Status: **Full pipeline built and tested.** The [technical specification](./question-bank-spec.md) is finalised (v0.1) and the whole spine runs locally with unit, integration, and end-to-end tests: submit → embed (pinned `nomic-embed-text`) → dedup-at-source → moderation + clustering → LLM-assisted refinement → definedness scoring + curation → pairwise comparison (TrueSkill, adaptive pairing) → ranked agenda → synthesis (LLM proposes, human endorses). A public discovery surface (campaign index, question bank, ranked agendas, open judging) is in place. The next steps — workspace scoping, full-text search, browsable similarity, campaign front doors, and dashboards — are tracked in the [improvement plan](./IMPROVEMENT-PLAN.md).

## The defensible core: the refinement log

Every LLM-assisted improvement to a question is captured as an append-only **transformation record** — building an open, versioned training set, with published scoring criteria, as a side effect of normal use.

## Design commitments (non-negotiable)

- **Transparency** — every ranking, grouping, and refinement is explainable and auditable. No black boxes.
- **Reproducibility** — the embedding model is pinned per dataset version; re-clustering happens only at version boundaries. Rankings never silently shift.
- **Provenance** — every record carries the model, model version, actor, and timestamp that produced it. All transformation tables are append-only.
- **Openness** — data is exportable under a defined licence; anonymous submissions are genuinely *unlinkable*.

## The pipeline (the product)

```
Submit
  → Embed (pinned model)
  → Dedup-at-source (show nearest existing; "yours or new?")
  → Cluster (assign-to-nearest within active version)
  → LLM-assisted refinement (logged transformation)
  → Definedness scoring (at curation, against published rubric)
  → Admin curates canonical comparison set
  → Pairwise prioritisation (TrueSkill, adaptive pairing)
  → Ranked agenda
  → Synthesis (LLM proposes, human endorses, lineage preserved)
```

The dashboards are a read layer on top of this spine.

## Stack (local-first)

A single `docker compose` stack, designed to run on one machine (target: Mac mini M4):

| Service | Role |
|---------|------|
| **Ollama** | Serves the pinned **embedding model** *and* the default **reasoning LLM** — two roles, one server. |
| **Postgres + pgvector** | One store for all relational/audit tables *and* the embedding vectors. No separate vector database. |
| **App (Next.js)** | Submit flow, front end, admin panel, API. |
| **OpenRouter** *(optional)* | Remote reasoning LLM for synthesis only, if you want a frontier model. A config bonus, never a requirement. |

**Model separation is critical:** the embedding model is *pinned per dataset version* (changing it forces a re-embed migration and a new version); the reasoning LLM is freely swappable per call and only ever *proposes* — humans accept.

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
(unit + integration; integration needs a `qb_test` database) and `npm run test:e2e`.

## Documentation

- [`question-bank-spec.md`](./question-bank-spec.md) — full technical specification (source of truth)
- [`definedness-rubric.md`](./definedness-rubric.md) — the five definedness criteria, defined (open training-set docs)
- [`IMPROVEMENT-PLAN.md`](./IMPROVEMENT-PLAN.md) — the v0.1 → v0.2 roadmap (see below)

## Roadmap

The pipeline above is complete. The [improvement plan](./IMPROVEMENT-PLAN.md) takes the app from a
rigorous-but-narrow prioritisation instrument to the fuller product in the brief, phase by phase:

1. **Workspace seam** — scope every query through a workspace so a hosted, multi-org future is an
   additive change, not a rewrite (one default workspace for now).
2. **Search & browsable similarity** — full-text search (Postgres `tsvector`) and "find similar"
   (reusing existing embeddings, no re-embed), with a public browse surface.
3. **Campaign front doors** — submit openly *or* into a specific campaign; a public campaign index.
4. **Dashboards & charts** — a visual read layer (pipeline health, ranking confidence) on existing
   data, themed to the palette and with accessible equivalents.
5. **Polish & coherence** — consistent navigation, empty/loading/error states, responsive QA.
6. **Full multi-tenancy** *(conditional)* — workspace lifecycle and isolation, built on the seam.

## Launch decisions (resolved)

The four open decisions from the spec are settled (2026-06-01):

1. **Export licence** — **CC0** (maximally open, frictionless downstream analysis).
2. **Default judging auth** — **open + fingerprinted** (per-campaign override to auth-required retained).
3. **Pinned embedding model** — **`nomic-embed-text`** (768-dim, fixing the pgvector column width). A local bake-off vs `mxbai-embed-large` / `bge-m3` still confirms before the first real migration.
4. **Definedness rubric** — five criteria defined in [`definedness-rubric.md`](./definedness-rubric.md): specific, answerable, scoped, non-leading, single-barrelled.

## Licence

Data export is licensed **CC0** (tracked separately from the code licence, which is decided before launch).
