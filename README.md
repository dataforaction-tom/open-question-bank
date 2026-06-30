# Question Bank

**A tool for working out which questions a community should prioritise.**

Question Bank takes a pile of submitted questions and turns it into a short, trustworthy, ranked
list — with every change to a question logged, so you can always see how it got there. It only
prioritises questions; actually answering them is a separate, later problem, out of scope for v1.

Open source and **local-first**: it runs on a single machine, no external services required. A
hosted version is also available, on the same code.

> Status: **v0.2 — the full pipeline plus a public site, built and tested, with a first deployed instance.** End to end: submit → embed (pinned `nomic-embed-text`) → check for duplicates → moderation + grouping → AI-assisted wording suggestions → quality check + curation → head-to-head comparison (TrueSkill ranking, adaptive pairing) → ranked agenda → synthesis (AI drafts, a human signs off). On top of that: full-text search and "find similar" (reusing existing embeddings, tuned cutoff, no re-embedding), a public site (campaign index, question bank, ranked agendas, open judging, a question-relationship map), submitting into a specific campaign as well as openly, admin and public dashboards, workspace scoping on every core module (single org today, ready to support more later), and a theme switcher. The [technical specification](./question-bank-spec.md) (v0.1) is still the source of truth for the core pipeline design; the [improvement plan](./IMPROVEMENT-PLAN.md) tracks what's shipped against the roadmap below.

## How question wording gets improved

When the AI assistant suggests clearer wording for a question, that suggestion is never applied
silently. Every suggestion, and the human decision to accept, edit, or reject it, is recorded —
so there's a full, open history of how a question's wording changed, and why.

## What we won't compromise on

- **Transparency** — every ranking, grouping, and wording change is explainable and auditable. No black boxes.
- **Reproducibility** — the embedding model is pinned per dataset version; questions are only re-grouped when that version changes. Rankings never silently shift underneath you.
- **Provenance** — every record carries the model, model version, actor, and timestamp that produced it. Nothing here is ever edited in place or deleted.
- **Openness** — data is exportable under a defined licence; anonymous submissions are genuinely *unlinkable*, even to admins.

## The pipeline

```
Submit
  → Embed (pinned model)
  → Check for duplicates (show the nearest existing match; "yours or new?")
  → Group with similar questions (within the current dataset version)
  → AI-assisted wording suggestions (every suggestion and decision logged)
  → Quality check (at curation time, against a published rubric)
  → Admin curates the comparison set
  → Head-to-head ranking (TrueSkill, adaptive pairing)
  → Ranked agenda
  → Synthesis (AI drafts, a human signs off, lineage kept)
```

The dashboards are a read-only view on top of this.

## Stack (local-first)

A single `docker compose` stack, designed to run on one machine (target: Mac mini M4):

| Service | Role |
|---------|------|
| **Ollama** | Serves the pinned **embedding model** *and* the default **reasoning LLM** — two roles, one server. |
| **Postgres + pgvector** | One store for all relational/audit tables *and* the embedding vectors. No separate vector database. |
| **App (Next.js)** | Submit flow, front end, admin panel, API. |
| **OpenRouter** *(optional)* | A remote model for synthesis only, if you want something more capable. Never required. |

The embedding model is *pinned per dataset version* — changing it means a full re-embed and a new
version. The reasoning LLM is freely swappable per call, and only ever *suggests* — a human always
decides.

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

- [User guide](https://dataforaction-tom.github.io/open-question-bank/) — for everyone using the site, and for admins running it (also in [`docs/user-guide.md`](./docs/user-guide.md) and [`docs/changelog.md`](./docs/changelog.md))
- [`question-bank-spec.md`](./question-bank-spec.md) — full technical specification (source of truth)
- [`definedness-rubric.md`](./definedness-rubric.md) — the five quality criteria, defined (open training-set docs)
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

The v0.1 pipeline and the [improvement plan](./IMPROVEMENT-PLAN.md)'s phases 1–5 are done and shipped:

1. ✅ **Workspace scoping** — every core module (campaigns, moderation, refinement, curation, comparison, synthesis, agenda) is scoped by workspace (one workspace today; ready to support more without a rewrite).
2. ✅ **Search & "find similar"** — full-text search and similarity browsing (reusing existing embeddings, no re-embedding, tuned cutoff), plus a public browse surface and a question-relationship map.
3. ✅ **Campaign front doors** — submit openly *or* into a specific campaign; a public campaign index.
4. ✅ **Dashboards & charts** — an admin pipeline-health dashboard and a public ranking-confidence view, themed and accessible.
5. ✅ **Polish & coherence** — consistent navigation (including a theme switcher), plain-language admin copy, empty/loading/error states.
6. **Full multi-tenancy** *(not started, optional)* — workspace creation and isolation in the UI, built on the scoping work from phase 1.

## Launch decisions (resolved)

The four open decisions from the spec are settled (2026-06-01):

1. **Export licence** — **CC0** (maximally open, frictionless downstream analysis).
2. **Default judging auth** — **open + fingerprinted** (per-campaign override to auth-required retained).
3. **Pinned embedding model** — **`nomic-embed-text`** (768-dim, fixing the pgvector column width). Still want to compare it against `mxbai-embed-large` / `bge-m3` before the first real migration.
4. **Quality rubric** — five criteria defined in [`definedness-rubric.md`](./definedness-rubric.md): specific, answerable, scoped, non-leading, single-barrelled.

## Licence

Data export is licensed **CC0** (tracked separately from the code licence, which is decided before launch).
