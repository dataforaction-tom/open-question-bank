# Question Bank — Technical Specification

**A collective intelligence and prioritisation tool for questions.**
Open source, self-hostable, with a hosted instance. Version 0.1 (spec).

---

## 1. What this is

A tool that takes a messy pool of submitted questions and produces a trustworthy, prioritised, synthesised agenda of questions — with every transformation logged, versioned, and open. It is a prioritisation instrument first; answering questions (via MCP/APIs) is an explicit later phase and is out of scope for v1.

The defensible, novel core is **the refinement log**: every LLM-assisted improvement to a question is captured as a transformation record, building an open, versioned training set with published scoring criteria as a side effect of normal use.

### Design commitments (non-negotiable)

- **Transparency.** Every ranking, grouping, and refinement is explainable and auditable. Nothing is a black box.
- **Reproducibility.** The embedding model is pinned per dataset version. Re-clustering happens only at version boundaries. Rankings don't silently shift.
- **Provenance.** Every record carries the model, model version, actor, and timestamp that produced it. All transformation tables are append-only.
- **Openness.** Data is exportable under a defined licence with anonymous submissions genuinely unlinkable.

---

## 2. The pipeline (the spine)

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

Each arrow is a state transition. The pipeline is the product; the dashboards are a read layer on top of it.

---

## 3. Model separation (critical)

Two distinct model roles. They must never be conflated.

| Role | Used for | Served by | Swappable? | Versioning |
|------|----------|-----------|------------|------------|
| **Embedding model** | Clustering, dedup, similarity | Local Ollama | Chosen once at instance startup. **Pinned per dataset version.** | Changing it requires an explicit re-embedding migration that mints a new dataset version. Warn hard on any change attempt. |
| **LLM (chat/reasoning)** | Refinement suggestions, definedness scoring, synthesis proposals | Local Ollama (default) or remote via OpenRouter | Freely swappable per call | Recorded on every record it produces |

Both roles run on the **same Ollama server**; the separation is one of role and policy, not infrastructure. The embedding model is pinned; the reasoning LLM is free to vary per call.

**Why:** the same questions cluster differently under different embedding models. If clustering were swappable, the "top 100" would change when you change a config value — which destroys reproducibility and contradicts the transparency commitment. The LLM, by contrast, only ever *proposes* (humans accept), so its swappability is safe and desirable.

**Self-hosted startup:** instance operator picks the embedding model at first boot from those available in their local Ollama (e.g. `nomic-embed-text` for short/direct questions, `mxbai-embed-large` for conceptual, `bge-m3` for multilingual). The choice — model name **and** its output dimensionality — is written into instance config and the first dataset version. The pgvector column is sized to that dimensionality. Attempting to change the model later surfaces a blocking warning explaining that all existing embeddings become incomparable and a full re-embed + new dataset version is required.

**Reasoning LLM:** defaults to a local Ollama model so a fresh instance is fully functional offline with no external dependency. OpenRouter (or any OpenAI-compatible endpoint) is an optional config addition for operators who want a frontier model for synthesis — a bonus, never a requirement.

---

## 4. Data model

All transformation tables (`Refinement`, `Comparison`, `Synthesis`, `DefinednessScore`) are **append-only**. Corrections are new rows, never edits.

### Question
| Field | Notes |
|-------|-------|
| `id` | |
| `raw_text` | As submitted, never mutated |
| `canonical_text` | Current best form (updated via accepted refinements) |
| `embedding` | Vector |
| `embedding_model_version` | Which pinned model produced it |
| `dataset_version` | Version this question's embedding belongs to |
| `submitter_ref` | Nullable. Pseudonymous token for anonymous; account ref for public |
| `visibility` | `anonymous` \| `public` (submitter's choice, per submission) |
| `state` | See state machine below |
| `tags` | LLM-suggested, human-confirmable |
| `theme` | |
| `cluster_id` | Nullable until clustered |
| `canonical_of` | Self-ref; points to the canonical question if this is a variant |
| `created_at` | |

### Refinement — *this is the training set*
| Field | Notes |
|-------|-------|
| `id` | |
| `question_id` | |
| `before` | Text before this transformation |
| `after` | Suggested/resulting text |
| `criteria_applied` | Which rubric criteria the suggestion targeted |
| `suggested_by` | `llm` \| `human` |
| `model` / `model_version` | If LLM (null for human) |
| `action` | `accept` \| `reject` \| `edit` |
| `actor_ref` | Who decided |
| `rationale` | LLM's stated reasoning (auditable) |
| `timestamp` | |

### Cluster
| Field | Notes |
|-------|-------|
| `id` | |
| `embedding_model_version` | |
| `dataset_version` | |
| `member_question_ids` | |
| `representative_question_id` | |
| `threshold_used` | The similarity threshold that formed this cluster — published, not hidden |

### DefinednessScore
| Field | Notes |
|-------|-------|
| `id` | |
| `question_id` | |
| `criterion` | One of: specific, answerable, scoped, non-leading, single-barrelled |
| `score` | |
| `rationale` | |
| `model` / `model_version` | |
| `timestamp` | |

Scored **at curation**, not at submission — dedup-at-source already filters the firehose, and gating submission adds friction that suppresses volume.

### Campaign
| Field | Notes |
|-------|-------|
| `id` | |
| `prompt` | e.g. "Most important questions about UK energy resilience" or open-ended "most important questions of our time" |
| `comparison_axis` | The dimension judges compare on — set per campaign. e.g. `importance` \| `urgency` \| `neglect`. Not hardcoded. |
| `dataset_scope` | `sealed` (own pool) \| `global` (draws from shared pool) — chosen deliberately at creation |
| `state` | `draft` \| `open` \| `comparing` \| `synthesising` \| `closed` |
| `opens_at` / `closes_at` | |

### Comparison
| Field | Notes |
|-------|-------|
| `id` | |
| `campaign_id` | |
| `question_a` / `question_b` | |
| `winner` | |
| `judge_ref` | |
| `served_reason` | Why this pair was shown (e.g. "high score uncertainty") — feeds transparency |
| `timestamp` | |

### Score (TrueSkill)
| Field | Notes |
|-------|-------|
| `question_id` | |
| `campaign_id` | |
| `mu` | Skill estimate |
| `sigma` | Uncertainty |
| `n_comparisons` | |
| `last_updated` | |

### Synthesis
| Field | Notes |
|-------|-------|
| `id` | |
| `campaign_id` | |
| `synthesised_text` | |
| `source_question_ids[]` | Full lineage back to constituent submissions |
| `rationale` | Why these were combined |
| `version` | |
| `proposed_by` | Always `llm` in the proposal step |
| `model` / `model_version` | |
| `endorsed_by[]` | Humans who endorsed; empty = proposal only, not adopted |
| `timestamp` | |

---

## 5. Question state machine

```
submitted
   │  (embed + dedup-at-source)
   ├──► merged-as-variant      (submitter chose an existing match)
   │
   ▼
clustered
   │  (admin promotes to comparison set)
   ▼
canonical
   │  (campaign enters comparing state)
   ▼
under-comparison
   │  (TrueSkill scores stabilise)
   ▼
ranked
   │  (included in a synthesis proposal, endorsed)
   ▼
synthesised
   │
   ▼
archived        (campaign closed; immutable snapshot retained)
```

Moderation sits as a gate before `clustered`: `submitted → flagged → {rejected | clustered}`. Even a light queue is required for an open submission surface (spam, abuse, off-topic, harmful).

---

## 6. Ranking: TrueSkill with adaptive pairing

**Why TrueSkill over Bradley-Terry:** native per-item uncertainty (`sigma`), which handles sparse volunteer judgement well and tells you when to stop comparing a pair.

**Pairing strategy:** never random, never full O(n²). Serve the pair that maximises expected information gain — typically two questions with close `mu` and high combined `sigma`. Stop serving a pair once the outcome is statistically settled. The `served_reason` is recorded and shown to the judge ("these two are closely matched and we're unsure which ranks higher").

**Comparison prompt:** driven by the campaign's `comparison_axis`. The judge sees: *"Which is more [important / urgent / neglected] for [campaign prompt]?"* — plus a "can't decide / both equal" option (TrueSkill handles draws).

**Transparency output:** for any ranked question, the tool can show its `mu`, `sigma`, `n_comparisons`, and the list of comparisons that produced its score. Rankings are never asserted without the evidence behind them.

**Sybil resistance (open instance reality):** an open, anonymous, public-ranking tool is trivially brigadable. v1 approach: rate-limit + fingerprint anonymous judging, and make vote provenance *visible* rather than pretending manipulation is impossible. Campaigns can optionally require auth for judging (trades openness for integrity — operator's choice).

---

## 7. Synthesis: LLM proposes, human endorses

1. At campaign `synthesising` state, the LLM is given the ranked canonical set and proposes candidate synthesised questions.
2. Each proposal carries `source_question_ids[]` (lineage) and a `rationale`.
3. Humans endorse, edit, or reject. A synthesis with empty `endorsed_by[]` is a proposal only — never presented as an output.
4. The synthesis act is versioned and logged like every other transformation.

The lineage is what makes a synthesised question citable and trustworthy: you can always trace a final agenda item back to the raw submissions that fed it.

---

## 8. Re-clustering policy

- **Within an active campaign/version:** new submissions are **assigned to nearest existing cluster** (or flagged as new if beyond threshold). Live rankings stay stable.
- **At version boundaries only:** full re-clustering. This mints a new `dataset_version`, optionally with a different threshold or (via migration) a different embedding model. Old version snapshots are retained immutably.

This is why a campaign's "top 100" doesn't shift under a participant mid-vote.

---

## 9. Front end (read layer)

- Submit flow with live dedup ("is yours one of these, or new?")
- Insights / trends over time
- Top 10 / 25 / 50 / 100 per campaign, each item showing its score evidence on demand
- Per-question detail: lineage, refinement history, definedness scores, comparison record
- Campaign pages (prompt, axis, ranked set, endorsed syntheses)

## 10. Admin panel

- Create/configure campaigns (prompt, `comparison_axis`, `dataset_scope`, schedule)
- Moderation queue
- Promote questions to canonical comparison set
- Trigger/endorse synthesis proposals
- Version management (initiate re-cluster, manage migrations)
- Analytics: submission volume, judging participation, score stability, cluster health, refinement accept/reject rates (the last doubles as training-set quality signal)

---

## 11. Open data export

- **Schema:** every table above, with transformation tables in full (they're the point).
- **Licence — decide before launch:** `CC0` (maximally open, frictionless analysis) vs `ODbL` (share-alike, derivatives stay open). *Recommendation: CC0 for the question/ranking data to maximise downstream analysis, given the transparency mission.*
- **Anonymisation guarantee:** anonymous submissions must be **unlinkable** in the export — pseudonymous tokens stripped or rotated, not merely name-removed. Designed in from the schema, not retrofitted. (UK/GDPR: also support withdrawal of a submission, which removes it from future exports while leaving an append-only tombstone for ranking integrity.)
- Snapshots are versioned; a published ranking can always be reproduced from its snapshot.

---

## 12. Cost governance

With Ollama serving both embeddings and the default reasoning LLM locally, a self-hosted instance has **zero marginal cost** — embedding every submission, definedness scoring, and synthesis proposals are all local compute. The only governance concern is local resource use, not spend.
- **Self-hosted (local Ollama):** no per-call cost. Governance is about not saturating the box — a queue for embedding/scoring jobs and sensible concurrency limits so a submission burst doesn't starve the reasoning model.
- **Optional OpenRouter reasoning:** if an operator opts into a remote LLM for synthesis, *that* reintroduces per-call cost — so caps (per-day call ceilings, per-campaign budgets) apply only on that path.
- **Hosted ("deployed by me"):** same Postgres+pgvector and Ollama stack on a larger box; rate limits protect shared resources rather than control spend.

---

## 13. Cold-start

A fresh instance with 12 questions looks dead. Provide:
- Seed question sets (importable, themed) so a new campaign has a populated comparison set immediately.
- Import path (CSV/JSON) for organisations bringing existing question pools.

---

## 14. Explicitly out of scope for v1

- Answering questions (MCP/API connection to find responses). Phase 2.
- Cross-campaign synthesis.
- Multi-language clustering (single pinned embedding model implies a primary language family per version).

---

## 15. Open decisions still requiring your call

1. **Export licence:** CC0 vs ODbL (recommendation: CC0).
2. **Default judging auth:** open+fingerprinted (max participation) vs auth-required (max integrity), as the per-campaign default.
3. **Embedding model choice:** which Ollama model to pin (recommendation: benchmark `nomic-embed-text`, `mxbai-embed-large`, and `bge-m3` locally against a sample of real questions before pinning — see §16). The *dimensionality* of the chosen model fixes the pgvector column width, so this is decided before the first migration.
4. **Definedness rubric wording:** the five criteria (specific, answerable, scoped, non-leading, single-barrelled) need final published definitions — these become part of the open training-set documentation.

---

## 16. Stack & deployment (local-first)

The entire system runs on a single machine (target: Mac mini M4) with no required external dependency. One `docker compose` stack:

| Service | Role |
|---------|------|
| **Ollama** | Serves the pinned embedding model **and** the default reasoning LLM. Two roles, one server (see §3). |
| **Postgres + pgvector** | Single store for everything — all relational/audit tables **and** the embedding vectors. No separate vector database. |
| **App (Next.js)** | Submit flow, front end, admin panel, API. |
| **OpenRouter** *(optional)* | Remote reasoning LLM for synthesis, if the operator wants a frontier model. Config bonus, not a requirement. |

### Why Postgres + pgvector rather than a vector database

The data model is overwhelmingly relational: foreign keys throughout, append-only audit tables, the lineage joins that make synthesis traceable, the pairwise comparison matrix. The vectors are a small slice (embeddings on `Question`, used only for dedup and clustering). A vector-first database (Qdrant, Chroma, etc.) would put the centre of gravity in the wrong place and force a two-database architecture for all the structured data. pgvector keeps relational data and vectors in one place, with mature HNSW indexing.

Decisively, **one backend serves both the self-hosted version and the hosted ("deployed by me") version** with no architecture change — avoiding the trap of maintaining two storage layers and two sets of queries.

### Considered and deferred: single-file SQLite

SQLite + `sqlite-vec` (or libSQL/Turso, which has vector search built in) is attractive for distribution — the database is one file, backups are a file copy, no server process for other self-hosters to run. Deferred for two reasons: `sqlite-vec` is still pre-1.0 (0.1.9 as of early 2026), which is a thin foundation for a tool whose credibility rests on reproducible, auditable clustering; and resting other people's self-hosted instances on a pre-1.0 vector extension pushes that risk onto them. If the zero-server distribution story later proves worth the trade, libSQL is the more production-hardened route — though note it uses DiskANN rather than HNSW, a different recall/latency profile to plan for.

### Embedding model selection (the one pre-build benchmark)

Because the choice is pinned and dimensionality-fixing, run a quick local bake-off before the first migration:
1. Pull `nomic-embed-text`, `mxbai-embed-large`, and `bge-m3` into Ollama.
2. Embed a sample of real (or representative) questions with each.
3. Eyeball the clusters each produces against human judgement of which questions *are* near-duplicates.
4. Pin the winner — `nomic-embed-text` is the sensible default for short, direct questions; `mxbai-embed-large` if campaigns lean conceptual; `bge-m3` if multilingual matters. Record the model name and dimensionality in instance config; size the pgvector column accordingly.

### Migration / re-embedding path

Changing the embedding model (or re-clustering at a version boundary, §8) is a deliberate operation: stand up a new `dataset_version`, re-embed all questions with the new pinned model, re-cluster, retain the old version as an immutable snapshot. This is the *only* sanctioned way the embedding model ever changes.
