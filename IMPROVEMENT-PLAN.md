# Question Bank — Improvement Plan (v0.1 → v0.2)

A hand-off plan to take the app from a rigorous-but-narrow prioritisation instrument to the
fuller product in the original brief: open and campaign submission, search, browsable
similarity, charts and dashboards, a proper public surface, and a clear local/cloud story.

This is written to be executed by Claude Code, phase by phase. Each phase is a self-contained
piece of work with its own acceptance criteria and tests. Do them in order unless a dependency
note says otherwise.

---

## 1. How to use this plan

- Work one phase per branch / PR. Keep PRs reviewable.
- Every phase ships with tests in the existing structure (`tests/unit`, `tests/integration`,
  `tests/e2e`) and leaves `npm test` and `npm run test:e2e` green.
- Run `npm run lint` and `tsc` clean before opening a PR.
- New schema changes go through Drizzle (`drizzle.config.ts`, `npm run db:migrate`). Never edit
  applied migrations; add new ones.
- New UI reuses the existing design system and components (`PageShell`, `Card`, `Button`,
  `Stamp`, `Notice`, `Field`) and the "Warm Civic" tokens in `src/app/globals.css`. Do not
  introduce a second visual language.

## 2. Guardrails — do not break these

The project's credibility rests on four commitments. Every phase must preserve them:

- **Reproducibility.** The embedding model is pinned per dataset version. Nothing in this plan
  may trigger a re-embed or change the pgvector column width. Search and "find similar" reuse
  *existing* embeddings within the active version only.
- **Provenance.** Every record carries model, version, actor, timestamp. New writes follow the
  same pattern.
- **Append-only.** `refinement`, `moderationEvent`, `definednessScore`, `comparison`, `score`,
  `synthesis` are append-only. New features may read them freely but must not mutate or delete.
- **Openness without de-anonymisation.** Anonymous submissions are unlinkable. Any new public
  read surface (search, browse, dashboards) must not expose fingerprints, actor identity, or
  anything that re-links an anonymous submitter.

Accessibility is also a standing requirement, not a phase: keep the existing focus-ring and
`prefers-reduced-motion` behaviour, and give every chart an accessible text/table equivalent.

## 3. Decisions to make before coding

Two decisions block or shape later phases. Resolve them first.

**D1 — Tenancy.** Does one deployed instance need to serve multiple organisations who must not
see each other's questions and campaigns? Three options:

- *Single-tenant only.* Each community runs its own instance. Simplest. Drop Phase 6 entirely.
- *Workspace seam now, full tenancy later (recommended).* Introduce a `workspace` concept with
  exactly one default workspace and route every query through a scoping helper from the start,
  without building sign-up, switching, or isolation UI yet. This makes going multi-tenant later
  an additive change rather than a rewrite of every query against append-only tables.
- *Full multi-tenancy now.* Only if you have a concrete near-term hosted, multi-org use.

This plan assumes the recommended middle path: **Phase 1 builds the seam; Phase 6 is the optional
full build.** If you pick single-tenant only, still do Phase 1 (it costs little and keeps the code
honest), and skip Phase 6.

**D2 — Charting approach.** The data for charts already exists; nothing is drawn. Decide between a
charting library (faster) and hand-rolled SVG (better brand fit, more work). Recommendation: pick a
library you can fully restyle to the palette — verify React 19 compatibility as the first task of
Phase 5 (Recharts 3.x or visx are the likely candidates; do not assume a version works, check it).
Charts must use `--moss`, `--clay`, `--sage` etc., never default library colours.

---

## Phase 0 — Housekeeping (small, do first)

**Goal:** stop the repo misrepresenting itself and de-risk the two spikes.

- Update `README.md`: the pipeline through compare → rank → synthesise is built and tested. Correct
  the "Slices 1–4 / remaining slices next" status to reflect reality.
- Add a short "Roadmap" section linking to this plan.
- Spike (timeboxed, throwaway): confirm the chosen charting library renders under React 19, and
  confirm Postgres full-text search is available in the Docker image (`docker-compose.yml`). Record
  findings in the PR description.

**Done when:** README matches the code; both spikes have a recorded yes/no.

---

## Phase 1 — Workspace seam (foundational)

**Goal:** introduce workspace scoping as a structural seam so the cloud/tenancy decision is cheap
later, even though only one workspace exists for now.

**Schema (`src/db/schema.ts` + new migration):**

- Add `workspace` table: `id`, `slug` (unique), `name`, `createdAt`.
- Seed exactly one default workspace in `npm run db:seed`.
- Add a non-null `workspaceId` (defaulting to the default workspace) to the top-level entities:
  `question`, `campaign`, `datasetVersion`. Derive workspace for child/append-only tables through
  their parent rather than denormalising onto every table, unless a query path needs it directly.

**Code:**

- Add a single scoping helper (e.g. `src/lib/workspace.ts`) that resolves the active workspace and
  is threaded through every list/read/write in `src/lib/*` and the API routes. The point is that no
  query reaches the DB without passing through workspace scope, even with one workspace today.
- Default resolution: the single default workspace. No UI, no switching yet.

**Done when:** all existing tests pass unchanged in behaviour; every data-access path is workspace-
scoped; adding a second workspace row would correctly partition data with no further query changes.

---

## Phase 2 — Search and browsable similarity

**Goal:** make the bank a *bank* — something you can search and explore, publicly and in admin.

**Keyword / full-text search:**

- Add a Postgres `tsvector` generated column (or trigger-maintained column) over the canonical
  question text, plus a GIN index, via a new migration. This is independent of embeddings.
- New lib: `src/lib/search.ts` — `searchQuestions({ workspaceId, query, filters, page })` using
  `websearch_to_tsquery`, ranked with `ts_rank`, with filters for cluster, campaign, definedness
  band, and state.
- New API: `GET /api/questions/search` (public, read-only, anonymised) and an admin variant if
  admin needs unpublished states.

**Browsable similarity ("find similar"):**

- New lib function reusing existing embeddings within the active dataset version (cosine distance,
  same approach as `src/lib/dedup.ts`). No re-embedding.
- New API: `GET /api/questions/[id]/similar`.

**Public browse surface:**

- `src/app/browse/page.tsx`: search box, results list, filters, "find similar" affordance on each
  result. Built from existing components.
- `src/app/questions/[id]/page.tsx` (public, published questions only): canonical text, cluster,
  campaign membership, refinement lineage summary (no anonymous identity), nearest similar.

**Done when:** a member of the public can search the bank, filter it, open a question, and see
similar questions — without any path exposing anonymous submitter identity. Unit + integration
tests cover ranking, filters, anonymisation, and the similar endpoint.

---

## Phase 3 — Campaign front doors (submit openly *or* into a campaign)

**Goal:** deliver the half of the original brief where submission can target a theme/campaign, not
just the global pool.

**Schema:**

- Allow a submission to carry an optional originating `campaignId` at submission time (additive;
  keep existing curation-time `campaignQuestion` association intact). Decide and document the
  relationship: submission-time association as a *signal*, with admin curation still the gate into a
  campaign's canonical comparison set. Do not bypass moderation.

**API / lib:**

- Extend `POST /api/questions` to accept an optional `campaignId`, validated with Zod, scoped to the
  workspace, and only when the campaign is open.
- Dedup-at-source still runs; "yours or new?" remains.

**Public surface:**

- `src/app/campaigns/page.tsx`: public index of open/published campaigns in the workspace (currently
  missing — campaigns are only reachable by ID).
- `src/app/campaigns/[id]/submit/page.tsx` or a mode on the existing submit page: arrive at a
  campaign, see its prompt and comparison axis, submit into it. Reuse the dedup flow.
- Link the homepage to browse and to the campaign index so the app has a way in beyond the single
  submit button.

**Done when:** someone can land on a campaign, read its prompt, and submit into it; open submission
still works; moderation and curation remain the gate. e2e covers both submission routes.

---

## Phase 4 — Dashboards and charts

**Goal:** the visual read layer the brief asked for, on data that already exists.

**Admin dashboard (`src/app/admin/page.tsx` or `/admin/dashboard`):**

- Pipeline health: submissions over time, moderation queue depth, cluster sizes, definedness-score
  distribution, refinement throughput, comparisons completed vs needed, ranking confidence
  (TrueSkill sigma narrowing over time).
- Each chart reads from existing tables; add read-only aggregate queries in a new
  `src/lib/analytics.ts`, workspace-scoped.

**Public campaign dashboard:**

- Augment the existing agenda page with visual ranking confidence (mu with sigma bands), number of
  comparisons, participation, and synthesis lineage — drawn, not just listed.

**Requirements:**

- Charts themed strictly to the Warm Civic palette.
- Every chart has an accessible equivalent (a `<table>` or text summary) and respects reduced-motion.
- No new heavy client state; server components where possible, with charts as client islands.

**Done when:** an admin can see the health of the pipeline at a glance; the public can see how an
agenda was arrived at, visually; all charts are themed and accessible. Integration tests cover the
aggregate queries; e2e smoke-tests that dashboards render with seeded data.

---

## Phase 5 — Polish and coherence

**Goal:** make the surfaces added above feel like one product.

- Navigation: a consistent header across public surfaces (home, browse, campaigns, submit) and a
  coherent admin nav. Keep it minimal and on-brand.
- Empty states for search, browse, campaign index, dashboards (reuse `EmptyState`).
- Loading and error states using `Notice`.
- A pass on responsive behaviour and the reveal choreography so new pages match existing ones.
- Visual QA pass before merge (this matters: review rendered pages, not just code).

**Done when:** a first-time visitor can move between home, browse, a campaign, and an agenda without
hitting a dead end or a page that looks like it belongs to a different app.

---

## Phase 6 — Full multi-tenancy (conditional on D1)

**Only if D1 chose full tenancy.** Builds directly on the Phase 1 seam.

- Workspace lifecycle: create workspaces, per-workspace slug routing (e.g. `/{workspace}/browse`).
- Scope admin auth to a workspace (`src/lib/admin-auth.ts`, `src/middleware.ts`); an admin belongs
  to one or more workspaces.
- Per-workspace dataset versions and pinned embedding models (the seam already isolates these).
- Isolation tests: no query, search, or dashboard leaks across workspaces; anonymous unlinkability
  holds within and across workspaces.
- Resource governance per the spec's hosted notes (queues, concurrency limits) so one workspace's
  submission burst doesn't starve another.

**Done when:** two workspaces on one instance are fully isolated end to end, proven by tests.

---

## Cross-cutting requirements (apply to every phase)

- **Tests:** match the existing split. New lib logic → `tests/unit`; new DB/API behaviour →
  `tests/integration` (needs `qb_test`); new user journeys → `tests/e2e`.
- **Performance:** add indexes with the migrations that need them (GIN for full-text; confirm the
  pgvector index supports the similarity browse volume). Paginate all list/search endpoints.
- **Provenance & append-only:** preserve as in the guardrails. Reads are free; mutations follow the
  established pattern.
- **Anonymity:** every new public read is reviewed for re-linkage risk before merge.
- **Design:** existing tokens and components only; charts themed to palette; accessible equivalents
  and reduced-motion respected throughout.

## Suggested sequence

0 → 1 → 2 → 3 → 4 → 5, with 6 only if D1 says so. Phases 2, 3 and 4 each deliver visible value on
their own, so they can ship and be used independently once Phase 1's seam is in.
