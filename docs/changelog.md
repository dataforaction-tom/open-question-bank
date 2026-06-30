# Changelog

All notable changes to this project are documented here, newest first.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/). Entries describe
what changed for the people using the app, not the underlying implementation.

## 2026-06-30 — Plain-language admin, smarter "similar questions," first deployment

### Added
- The moderation queue now shows which campaign (if any) a question was submitted through.
- The "comparison axis" field when creating a campaign is now a proper choice (Importance, Impact,
  Urgency, or your own), each with a short explanation, plus a live preview of what judges will be
  asked.
- A "Log in" link now appears on the public site so admins can find their way to the admin area.
- The app now has a first deployed instance, running continuously for staging/review use.

### Changed
- Admin pages now use plain language throughout instead of internal pipeline terms — "ready"
  instead of "canonical," "grouped" instead of "clustered," "quality check" instead of
  "definedness scoring," and so on.
- The admin navigation order now matches the order you'd actually use it in: Moderation,
  Refinement, Curation, Campaigns.
- Every admin page now has a one-line description of what it's for.

### Fixed
- "Find similar" was showing largely unrelated questions alongside genuinely similar ones — it now
  applies a proper closeness cutoff, tuned against real results, so only questions that are
  actually on-topic are shown.

## 2026-06-29 — Community demand and the question map

### Added
- Published questions now show "N submissions merged here" when several people asked essentially
  the same thing — a visible signal of demand.
- A new visual **question map**: a network diagram showing how published questions relate to one
  another, sized by demand and grouped by theme, with a plain data table alternative underneath.
  Available on both the public browse page and the admin dashboard.

### Changed
- Questions with more submissions behind them now start prioritisation comparisons with a head
  start, reflecting that demand.
- Submitting a question that turns out to be a near-duplicate no longer triggers a second,
  redundant AI call behind the scenes.

## 2026-06-25 — Search, browsing, dashboards, and campaign front doors

A large milestone bringing the app from "a working pipeline" to "a place the public can actually
explore."

### Added
- A public **Browse** page with keyword search, theme filters, and "find similar" on every result.
- A public page for every published question, showing its theme, related questions, and (where
  applicable) which campaign ranked it.
- A way to submit a question directly into a specific open campaign, alongside open submission.
- Admin and public **dashboards** — pipeline health at a glance for admins, and a visual look at
  how a ranked agenda was arrived at for the public.
- A plain-language presentation of ranked agendas, with technical detail available on demand
  rather than shown by default.
- An app-wide **theme switcher** (Auto, Warm Civic, Warm Civic Dark, and a new Climate Barometer
  look), remembered per device.
- Questions are now automatically sorted into broad topic themes when approved.

### Changed
- The groundwork was laid for this instance to one day host multiple separate organisations
  without their data mixing — invisible today, but it means a future hosted version is a smaller
  step than a rewrite.

## 2026-06-23 to 2026-06-24 — Ranked agendas, synthesis, and public discovery

### Added
- Closing a campaign now produces a published **ranked agenda** — the final order, with the
  evidence behind each position.
- An optional **synthesis** step: an AI assistant can draft a single question that captures the
  heart of several closely related, highly-ranked ones. Nothing is published without a human
  explicitly reviewing and endorsing it, and the original questions it drew from are always shown.
- A public index of campaigns (open and finished) and a public, curated index of published
  questions — previously campaigns were only reachable if you already had a direct link.

## 2026-06-15 to 2026-06-16 — Campaigns and open judging

### Added
- **Campaigns**: themed rounds of prioritisation with their own question sets.
- Head-to-head comparison judging — pick which of two questions matters more, repeated until a
  confident ranking emerges (using the same family of algorithm used to rank players in online
  games).
- Public judging: anyone can help rank a campaign's questions, anonymously, without ever being
  shown the same pair twice.

## 2026-06-12 to 2026-06-13 — A proper look and feel

### Added
- The "Warm Civic" visual design system — the look and feel used across the whole site from this
  point on.

## 2026-06-10 — Quality checks and curation

### Added
- A **quality check** for questions, scoring them against five criteria (specific, answerable,
  clearly scoped, neutral, and asking just one thing), each with a short explanation. Always
  advisory — the decision to mark a question ready stays with an admin.
- Admins can now promote quality-checked questions to "ready," making them eligible for campaigns.

## 2026-06-02 to 2026-06-05 — AI-assisted wording suggestions

### Added
- An optional **refinement** step: an AI assistant suggests clearer wording for a submitted
  question, with its reasoning shown alongside. Admins can accept, edit further, or reject the
  suggestion — every decision and every previous wording is kept, so nothing is ever silently
  rewritten.

## 2026-06-01 — Initial release

The first working version of the pipeline.

### Added
- Public question **submission**, with a check for near-duplicates ("is this yours, or new?")
  before anything is added.
- An admin **moderation queue** to approve or reject newly submitted questions.
- Automatic grouping of approved questions with similar existing ones.
- Admin login, protecting everything beyond public submission and (later) browsing.
