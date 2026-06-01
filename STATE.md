# State

> Last updated: 2026-06-01

## System State Diagram

```mermaid
stateDiagram-v2
    [*] --> Planning: project started
    Planning --> Setup: plan approved
    Setup --> Building: environment ready
    Building --> Testing: features complete
    Testing --> Deploying: tests pass
    Deploying --> Live: deployed

    note right of Planning: ← WE ARE HERE (spec done, repo set up, planning the build)
```

## Component Status

| Component | Status | Notes |
|-----------|--------|-------|
| Spec | ✅ Done | `question-bank-spec.md` v0.1, local-first stack finalised |
| Repo + Claude template | ✅ Done | Pushed to `dataforaction-tom/open-question-bank` (public) |
| Open decisions (§15) | ⏳ Not started | Licence, judging auth, embedding model, rubric wording |
| Embedding bake-off | ⏳ Not started | Fixes pgvector dimensionality — gates first migration |
| Next.js app + docker compose | ⏳ Not started | Ollama + Postgres/pgvector + app |
| DB schema + migrations | ⏳ Not started | Append-only transformation tables, dataset-version aware |
| Submit + Embed + Dedup | ⏳ Not started | Pipeline slice 1 |
| Cluster + moderation gate | ⏳ Not started | Slice 2 |
| LLM refinement (training set) | ⏳ Not started | Slice 3 — the defensible core |
| Definedness scoring + curation | ⏳ Not started | Slice 4 |
| Campaigns + TrueSkill comparison | ⏳ Not started | Slice 5 |
| Ranked agenda + evidence views | ⏳ Not started | Slice 6 |
| Synthesis (propose/endorse) | ⏳ Not started | Slice 7 |
| Open data export + anonymisation | ⏳ Not started | CC0/ODbL TBD; GDPR withdrawal tombstones |
| Cold-start seeds + import | ⏳ Not started | CSV/JSON |

Markers: ⏳ Not started · 🔧 In progress · ✅ Done · 🚫 Blocked · ⚠️ Needs attention

## Data Flow (the pipeline spine)

```mermaid
flowchart LR
    S[Submit] --> E[Embed<br/>pinned model]
    E --> D[Dedup-at-source<br/>yours or new?]
    D --> C[Cluster<br/>assign-to-nearest]
    C --> R[LLM refinement<br/>logged transformation]
    R --> DS[Definedness<br/>scoring at curation]
    DS --> CU[Admin curates<br/>canonical set]
    CU --> P[Pairwise prioritisation<br/>TrueSkill + adaptive pairing]
    P --> RA[Ranked agenda]
    RA --> SY[Synthesis<br/>LLM proposes, human endorses]
```

## Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| Ollama (embedding + reasoning LLM) | Not set up | Local server; embedding model pinned per dataset version |
| Postgres + pgvector | Not set up | Single store, relational + vectors; column width set by embedding dim |
| OpenRouter (optional) | Not set up | Remote reasoning for synthesis only; reintroduces per-call cost |
| Docker / docker compose | Available locally | Orchestrates the single-machine stack |

<!--
Keep this file as the single source of truth for "where are we?"
The /status command reads this file.
-->
