# Question Bank

**A collective intelligence and prioritisation tool for questions.**

Question Bank takes a messy pool of submitted questions and produces a trustworthy, prioritised, synthesised agenda — with every transformation logged, versioned, and open. It is a **prioritisation instrument first**; answering questions is an explicit later phase, out of scope for v1.

Open source and **local-first**: the whole system runs on a single machine with no required external dependency. A hosted instance is offered too, on the same backend.

> Status: **v0.2 — full pipeline plus public surface, built and tested, with a first deployed instance.** The whole spine runs end to end with unit, integration, and end-to-end tests: submit → embed (pinned `nomic-embed-text`) → dedup-at-source → moderation + clustering → LLM-assisted refinement → definedness scoring + curation → pairwise comparison (TrueSkill, adaptive pairing) → ranked agenda → synthesis (LLM proposes, human endorses). On top of that spine: full-text search and browsable similarity (cosine-distance, tuned cutoff — no re-embedding), a public discovery surface (campaign index, question bank, ranked agendas, open judging, question-relationship graph), campaign front doors (submit openly or into a campaign), admin + public dashboards, a workspace scoping seam on every core module (single-tenant today, additive to multi-tenant later), and a theme switcher. The [technical specification](./question-bank-spec.md) (v0.1) remains the source of truth for the core pipeline design; the [improvement plan](./IMPROVEMENT-PLAN.md) tracks what shipped against the v0.2 roadmap below.

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

- [`docs/user-guide.md`](./docs/user-guide.md) — end-user and admin guide (plain language; also hosted via `mkdocs.yml`)
- [`docs/changelog.md`](./docs/changelog.md) — dated, user-facing changelog
- [`question-bank-spec.md`](./question-bank-spec.md) — full technical specification (source of truth)
- [`definedness-rubric.md`](./definedness-rubric.md) — the five definedness criteria, defined (open training-set docs)
- [`IMPROVEMENT-PLAN.md`](./IMPROVEMENT-PLAN.md) — the v0.1 → v0.2 roadmap (see below)

## Deployment

The repo ships a `Dockerfile` and `docker-compose.yml` (app + Postgres/pgvector + Ollama) for a
self-contained single-host deploy. `docker-compose.prod.yml` is an override for hosts that already
run Ollama natively — it points the app at the host's Ollama instead of bundling a second one, and
drops direct port exposure for a reverse-proxy setup (e.g. a Cloudflare Tunnel):

```bash
docker compose -p <project> -f docker-compose.yml -f docker-compose.prod.yml up -d --build app db
```

## Roadmap

The v0.1 pipeline and the [improvement plan](./IMPROVEMENT-PLAN.md)'s phases 1–5 are complete and
shipped:

1. ✅ **Workspace seam** — every core module (`campaign`, `moderation`, `refinement`, `curation`,
   `comparison`, `synthesis`, `agenda`) scopes by workspace (one default workspace today; additive
   to full multi-tenancy later).
2. ✅ **Search & browsable similarity** — full-text search (Postgres `tsvector`) and "find similar"
   (reusing existing embeddings, no re-embed, tuned distance cutoff), with a public browse surface
   and a question-relationship graph.
3. ✅ **Campaign front doors** — submit openly *or* into a specific campaign; a public campaign index.
4. ✅ **Dashboards & charts** — admin pipeline-health dashboard and a public ranking-confidence view,
   themed to the palette with accessible equivalents.
5. ✅ **Polish & coherence** — consistent nav (including a theme switcher), plain-language admin
   copy, empty/loading/error states.
6. **Full multi-tenancy** *(conditional, not started)* — workspace lifecycle and isolation UI, built
   on the seam from phase 1.

## Launch decisions (resolved)

The four open decisions from the spec are settled (2026-06-01):

1. **Export licence** — **CC0** (maximally open, frictionless downstream analysis).
2. **Default judging auth** — **open + fingerprinted** (per-campaign override to auth-required retained).
3. **Pinned embedding model** — **`nomic-embed-text`** (768-dim, fixing the pgvector column width). A local bake-off vs `mxbai-embed-large` / `bge-m3` still confirms before the first real migration.
4. **Definedness rubric** — five criteria defined in [`definedness-rubric.md`](./definedness-rubric.md): specific, answerable, scoped, non-leading, single-barrelled.

## Licence

Data export is licensed **CC0** (tracked separately from the code licence, which is decided before launch).
