# Definedness Rubric

> Status: **v1 (published)**. Last updated: 2026-06-01.
> These definitions are part of the open training-set documentation. They are scored **at curation**, not at submission (see spec §4, §5).

A question's **definedness** is scored against five independent criteria. Each is scored separately, with a model-supplied `rationale`, and stored as an append-only `DefinednessScore` row carrying `model`, `model_version`, and `timestamp` (spec §4).

The five criteria are deliberately **non-overlapping** — each tests one distinct property. The two most easily confused, *specific* and *scoped*, are split as **concreteness** vs **boundedness**.

## The five criteria

### 1. Specific — *concreteness vs vagueness*
The question is concrete enough to act on, not abstract or woolly.

- **Fails when:** too general to yield a meaningful answer.
- ❌ *"How do we fix education?"*
- ✅ *"What policy changes would raise UK primary-school literacy rates?"*

### 2. Answerable — *can it be answered at all*
It is possible in principle to answer the question — evidence, reasoning, or investigation could settle it.

- **Fails when:** unfalsifiable, purely rhetorical, or no conceivable evidence would resolve it.
- ❌ *"Is the universe fair?"*
- ✅ *"Does a four-day week reduce burnout in knowledge workers?"*

### 3. Scoped — *bounded extent*
The question has clear boundaries — domain, population, timeframe, or context.

- **Fails when:** boundless; no clear *who / where / when*.
- ❌ *"What should society do?"*
- ✅ *"What should UK secondary schools prioritise in the 2026 curriculum?"*

A question can be **specific but unscoped** (*"What policy would raise literacy?"* — concrete ask, but for whom/where?) or **scoped but vague** (*"What should UK schools do in 2026?"* — bounded, but woolly). The two criteria are independent.

### 4. Non-leading — *neutrality*
The question does not presuppose its own answer or embed bias.

- **Fails when:** it smuggles in a conclusion or loads the framing.
- ❌ *"Why is remote work bad for teams?"* (presupposes it is bad)
- ✅ *"What effect does remote work have on team cohesion?"*

### 5. Single-barrelled — *one ask*
The question asks about exactly one thing.

- **Fails when:** two or more distinct questions are bundled under one answer — usually joined by "and"/"or", or a smuggled second clause.
- ❌ *"How do we fund **and** staff the NHS?"* (two asks; a judge can't answer cleanly)
- ✅ *"How do we improve NHS staffing levels?"*

## Quick-reference table

| Criterion | Tests | Fails when… |
|---|---|---|
| **Specific** | Concreteness vs vagueness | Too general/abstract to act on |
| **Answerable** | Can it be answered at all | Unfalsifiable, rhetorical, or no evidence could settle it |
| **Scoped** | Bounded extent | No clear domain / population / timeframe |
| **Non-leading** | Neutrality | Presupposes its own answer or embeds bias |
| **Single-barrelled** | One ask | Two+ distinct questions bundled together |
