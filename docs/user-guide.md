# User Guide

This guide covers everything you need to know about using Question Bank — both as a member of
the public submitting and exploring questions, and as an admin running the question pipeline for
an organisation or community.

## Submitting a question

Go to **Submit** to add a question to the bank. You can submit:

- **Openly**, into the general pool, or
- **Into a specific campaign**, if you arrived via a campaign's own submit page — your question
  carries a note of which campaign it came in through, but still has to go through the same
  checks as everything else before it can join that campaign's comparison set.

When you submit, the system checks whether something very similar already exists. If it finds a
close match, you'll be asked: is this **yours** (the same question, maybe worded differently) or
is it genuinely **new**? Choosing "yours" merges your submission into the existing question and
quietly counts toward how much demand there is for it — choosing "new" adds it as its own entry.

You can submit **anonymously** or **publicly** — either way, nobody outside the admin team can
link a question back to who asked it, and even admins only ever see a non-identifying reference,
never your name or contact details.

After submitting, your question goes to **moderation** before it's visible to anyone else (see
[Admin guide](#admin-guide)).

## Browsing the question bank

The **Browse** page lets you search and explore every question that's been published. You can:

- **Search** by keyword.
- **Filter by theme** — questions are automatically grouped into broad topics (e.g. transport,
  housing, environment) once they're approved.
- **See what's similar.** Open any question and use "Find similar" to see closely related
  questions already in the bank — handy for finding a fuller picture of a topic before you submit
  something that might already exist.
- **See how many people raised the same thing.** Where a question absorbed several near-identical
  submissions, you'll see "N submissions merged here" — a visible signal of how much demand there
  is behind it.
- **Explore the question map.** A visual network of how published questions relate to one
  another — questions on similar topics cluster together, sized by how much demand they've
  attracted. Click any point to open that question; there's also a plain data table underneath for
  anyone who prefers it or uses a screen reader.

## Campaigns

A **campaign** is a themed round of prioritisation — a focused question like *"Which community
priorities should shape next year's budget?"* with its own set of candidate questions, judged
against each other until a ranked list comes out the other end.

Visit **Campaigns** to see what's running. A campaign moves through stages:

1. **Open for submission** (optional) — you can submit questions directly into this campaign.
2. **Open for comparison** — anyone can help rank the campaign's questions (see below).
3. **Closed / Ranked** — comparison has finished and a final ranked agenda is published.

## Comparing and ranking questions

Once a campaign is open for comparison, anyone can help rank its questions. Open the campaign and
you'll be shown two questions at a time with a simple prompt — for example *"Which is more
important?"* (the exact wording depends on what the campaign is comparing on: importance, impact,
urgency, or something else the organisers chose). Pick the one you think matters more, and you'll
be shown another pair.

A few things worth knowing:

- You won't be shown the same pair twice.
- Your identity isn't recorded — just an anonymous browser fingerprint used only to stop the same
  pair being repeated to you.
- The ranking updates after every single comparison, using a confidence-based ranking method (the
  same family of algorithm used for ranking players in online games) — newer or less-compared
  questions get prioritised for more comparisons until the overall ranking is confident.

## Ranked agendas

Once a campaign closes, its final order is published as a **ranked agenda** — the question's
position, plus the evidence behind it (how many comparisons it won, and how confident the ranking
is). Nothing here exposes who submitted or who judged anything — it's the result, not the process.

## Synthesised questions

For some closed campaigns, an AI assistant drafts **synthesised questions** — a single question
that captures the heart of several closely related, highly-ranked questions. These are never
published automatically: a human always reviews and explicitly endorses a synthesis before it
appears publicly, and you can always see which original questions it drew from (its "lineage").

## Appearance

Use the theme switcher in the header to choose how the site looks: **Auto** (follows your device's
light/dark setting), **Warm Civic**, **Warm Civic Dark**, or **Climate Barometer** (a cooler,
all-sans-serif look). Your choice is remembered on your device.

---

## Admin guide

Admins log in at **/admin/login** with the shared admin password for this instance. Once logged
in, the admin area walks through the pipeline a question travels from "just submitted" to
"published and ranked," roughly in this order:

**Moderation → Refinement → Curation → Campaigns**

### Moderation

The **Moderation** queue lists every newly submitted question awaiting a decision. For each one
you can:

- **Approve** it — it's grouped with similar questions already in the bank (or starts a new group
  if nothing matches), ready for the next steps.
- **Reject** it, optionally with a reason.

If a question was submitted through a specific campaign, you'll see a "Submitted via" note on its
card so you know the context it came in with.

### Refinement

The **Refinement** page is optional — use it any time before a question is marked ready. It asks
an AI assistant to suggest clearer wording for a question (catching vague, unanswerable, or
double-barrelled phrasing), shows you its reasoning, and lets you **accept** the suggestion as-is,
**edit** it further, or **reject** it and keep the original wording. Every decision is recorded,
so you can always see a question's full wording history.

### Curation

The **Curation** page is where you run a **quality check** and decide which questions are ready to
be used in campaigns. The quality check scores a question against five criteria — is it specific,
answerable, clearly scoped, neutrally worded, and asking just one thing — each with a short
explanation. The check is advisory only: a low score doesn't block anything, the decision to mark
a question **ready** is always yours.

### Campaigns

The **Campaigns** page is where you set up and run prioritisation rounds:

- **Create a campaign** with a prompt (what you're asking) and a **comparison axis** — what judges
  are actually comparing questions on. Choose from Importance, Impact, or Urgency (each with a
  short explanation of what it means), or set your own with "Other." You'll see a live preview of
  exactly what judges will be shown — *"Which is more ___?"*
- **Assemble its question set** from the ready (quality-checked) questions.
- **Open it for submission and/or comparison**, and **close it** once enough comparisons have come
  in — closing moves its questions to "ranked" and publishes the agenda.
- Review and **endorse AI-drafted syntheses** once a campaign is closed, if any were proposed.

### Dashboard

The **Dashboard** gives a quick overview of pipeline health: how many questions are at each stage,
recent submission and comparison activity, quality-check distribution, the biggest groups of
similar questions, and the question map.

### A note on the shared admin password

This instance uses a single shared password for all admins rather than individual accounts — fine
for a small trusted team, but worth knowing if you're handing this off to a larger group.
