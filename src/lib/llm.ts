import { z } from 'zod'

/** The five definedness criteria (mirrors definedness-rubric.md). */
export const CRITERIA = ['specific', 'answerable', 'scoped', 'non-leading', 'single-barrelled'] as const

const criterionCritiqueSchema = z.object({
  criterion: z.enum(CRITERIA),
  verdict: z.enum(['pass', 'fail']),
  note: z.string(),
})

export const refinementSuggestionSchema = z.object({
  suggestedText: z.string().min(1),
  critique: z.array(criterionCritiqueSchema),
  criteriaApplied: z.array(z.enum(CRITERIA)),
  rationale: z.string(),
})

export type RefinementSuggestion = z.infer<typeof refinementSuggestionSchema> & {
  model: string
  modelVersion: string
}

const criterionScoreSchema = z.object({
  criterion: z.enum(CRITERIA),
  score: z.number().int().min(1).max(5),
  rationale: z.string().min(1),
})

/** Exactly five entries, each criterion present exactly once. */
export const scoreResultSchema = z
  .object({ scores: z.array(criterionScoreSchema).length(CRITERIA.length) })
  .refine((r) => new Set(r.scores.map((s) => s.criterion)).size === CRITERIA.length, {
    message: 'each criterion must appear exactly once',
  })

export type ScoreResult = z.infer<typeof scoreResultSchema> & {
  model: string
  modelVersion: string
}

export const synthesisResultSchema = z.object({
  proposals: z.array(
    z.object({
      synthesisedText: z.string().min(1),
      sourceQuestionIds: z.array(z.string()).min(1),
      rationale: z.string().min(1),
    }),
  ),
})

export type SynthesisResult = z.infer<typeof synthesisResultSchema> & {
  model: string
  modelVersion: string
}

export interface RankedQuestion {
  id: string
  canonicalText: string
}

export interface ReasoningProvider {
  refine(canonicalText: string): Promise<RefinementSuggestion>
  score(canonicalText: string): Promise<ScoreResult>
  synthesise(ranked: RankedQuestion[]): Promise<SynthesisResult>
}

/** Raised on any LLM transport or output-validation failure → maps to HTTP 502. */
export class ProviderError extends Error {}

const REFINE_TIMEOUT_MS = 60_000

const RUBRIC = `A well-defined question satisfies five independent criteria:
- specific: concrete enough to act on, not vague.
- answerable: evidence or reasoning could in principle settle it.
- scoped: has clear boundaries (domain / population / timeframe).
- non-leading: does not presuppose its own answer or embed bias.
- single-barrelled: asks about exactly one thing.`

export function buildRefinementPrompt(canonicalText: string): string {
  return `You improve questions against a definedness rubric.

${RUBRIC}

Question to refine:
"""${canonicalText}"""

Return ONLY a JSON object with this exact shape:
{
  "suggestedText": "the improved question",
  "critique": [{ "criterion": <one of the five>, "verdict": "pass" | "fail", "note": "short reason" }, ... one entry per criterion ...],
  "criteriaApplied": [<criteria your rewrite actually changed>],
  "rationale": "one or two sentences explaining the rewrite"
}`
}

/** Fuller rubric for scoring: definition + fails-when guidance (mirrors definedness-rubric.md). */
const SCORING_RUBRIC = `A well-defined question satisfies five independent criteria:
- specific (concreteness vs vagueness): concrete enough to act on. Fails when too general or abstract to yield a meaningful answer.
- answerable (can it be answered at all): evidence, reasoning, or investigation could in principle settle it. Fails when unfalsifiable, rhetorical, or no conceivable evidence would resolve it.
- scoped (bounded extent): clear boundaries — domain, population, timeframe, or context. Fails when boundless, with no clear who / where / when.
- non-leading (neutrality): does not presuppose its own answer or embed bias. Fails when it smuggles in a conclusion or loads the framing.
- single-barrelled (one ask): asks about exactly one thing. Fails when two or more distinct questions are bundled under one answer.`

export function buildScoringPrompt(canonicalText: string): string {
  return `You assess how well-defined a question is against a definedness rubric.

${SCORING_RUBRIC}

Score each criterion independently on an integer scale from 1 to 5:
1 = clearly fails the criterion, 3 = partially satisfies it, 5 = clearly satisfies it.

Question to score:
"""${canonicalText}"""

Return ONLY a JSON object with this exact shape:
{
  "scores": [
    { "criterion": <one of the five>, "score": <integer 1-5>, "rationale": "short reason for this score" },
    ... exactly one entry per criterion, all five criteria present ...
  ]
}`
}

export function buildSynthesisPrompt(ranked: RankedQuestion[]): string {
  const list = ranked.map((r) => `- id ${r.id}: ${r.canonicalText}`).join('\n')
  return `You synthesise a ranked set of related questions into a small number of
clearer, higher-level questions that capture what the set is really asking.

Ranked questions (most important first):
${list}

Propose 1 to 3 syntheses. Each must cite, in sourceQuestionIds, the ids of the
questions above that it draws from (use the exact ids from the list). Return ONLY
a JSON object with this exact shape:
{
  "proposals": [
    { "synthesisedText": "the synthesised question", "sourceQuestionIds": ["<id>", ...], "rationale": "why these were combined" },
    ...
  ]
}`
}

/** Shared chat-provider logic: call, zod-validate, retry once, resolve model_version. */
abstract class ChatProvider implements ReasoningProvider {
  constructor(protected readonly model: string) {}

  protected abstract callChat(prompt: string): Promise<unknown>
  protected abstract resolveModelVersion(): Promise<string>

  /**
   * One validated structured completion. Retries once, but ONLY on a transport or
   * output-validation failure (e.g. non-JSON output). Provenance resolution stays outside
   * the loop so a digest hiccup can't trigger a wasteful second LLM call.
   */
  protected async complete<T>(
    prompt: string,
    schema: z.ZodType<T>,
  ): Promise<T & { model: string; modelVersion: string }> {
    let parsed: T | undefined
    let lastErr: unknown
    for (let attempt = 0; attempt < 2 && parsed === undefined; attempt++) {
      try {
        parsed = schema.parse(await this.callChat(prompt))
      } catch (err) {
        lastErr = err
      }
    }
    if (parsed === undefined) {
      const message = lastErr instanceof Error ? lastErr.message : String(lastErr)
      throw new ProviderError(`Reasoning call failed: ${message}`)
    }
    const modelVersion = await this.resolveModelVersion() // never throws — falls back to the model id
    return { ...parsed, model: this.model, modelVersion }
  }

  async refine(canonicalText: string): Promise<RefinementSuggestion> {
    return this.complete(buildRefinementPrompt(canonicalText), refinementSuggestionSchema)
  }

  async score(canonicalText: string): Promise<ScoreResult> {
    return this.complete(buildScoringPrompt(canonicalText), scoreResultSchema)
  }

  async synthesise(ranked: RankedQuestion[]): Promise<SynthesisResult> {
    return this.complete(buildSynthesisPrompt(ranked), synthesisResultSchema)
  }
}

/** Local Ollama AND Ollama Cloud — same /api/chat shape; cloud just adds a bearer token. */
export class OllamaChatProvider extends ChatProvider {
  private readonly baseUrl: string
  private readonly apiKey?: string

  constructor(opts: { baseUrl: string; model: string; apiKey?: string }) {
    super(opts.model)
    this.baseUrl = opts.baseUrl
    this.apiKey = opts.apiKey
  }

  protected async callChat(prompt: string): Promise<unknown> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        format: 'json',
      }),
      signal: AbortSignal.timeout(REFINE_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`Ollama chat failed: ${res.status} ${await res.text()}`)
    const data = (await res.json()) as { message?: { content?: string } }
    return JSON.parse(data.message?.content ?? '')
  }

  protected async resolveModelVersion(): Promise<string> {
    // Cloud: no reliable per-account digest from /api/tags — record the model id (spec §3 fallback).
    if (this.apiKey) return this.model
    // Local: resolve the content digest from THIS server's /api/tags (not the shared OLLAMA_URL that
    // `getModelDigest` reads — that would mis-record the digest for a non-default base URL).
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`)
      if (!res.ok) return this.model
      const data = (await res.json()) as { models: { name: string; digest: string }[] }
      const match = data.models.find((m) => m.name === this.model || m.name === `${this.model}:latest`)
      return match?.digest ?? this.model
    } catch {
      return this.model
    }
  }
}

/** OpenRouter — OpenAI-compatible chat completions. */
export class OpenRouterProvider extends ChatProvider {
  private readonly baseUrl: string
  private readonly apiKey: string

  constructor(opts: { baseUrl: string; model: string; apiKey: string }) {
    super(opts.model)
    this.baseUrl = opts.baseUrl
    this.apiKey = opts.apiKey
  }

  protected async callChat(prompt: string): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(REFINE_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`OpenRouter chat failed: ${res.status} ${await res.text()}`)
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return JSON.parse(data.choices?.[0]?.message?.content ?? '')
  }

  protected async resolveModelVersion(): Promise<string> {
    return this.model // remote model id is the version identifier
  }
}

/** Deterministic provider for e2e (REASONING_PROVIDER=mock) — never calls the network. */
export class MockProvider implements ReasoningProvider {
  async refine(canonicalText: string): Promise<RefinementSuggestion> {
    return {
      suggestedText: `${canonicalText} (refined)`,
      critique: CRITERIA.map((criterion) => ({ criterion, verdict: 'pass', note: 'ok' })),
      criteriaApplied: ['specific'],
      rationale: 'Mock refinement for end-to-end tests.',
      model: 'mock',
      modelVersion: 'mock',
    }
  }

  async score(): Promise<ScoreResult> {
    return {
      scores: CRITERIA.map((criterion) => ({
        criterion,
        score: 4,
        rationale: `mock ${criterion} rationale`,
      })),
      model: 'mock',
      modelVersion: 'mock',
    }
  }

  async synthesise(ranked: RankedQuestion[]): Promise<SynthesisResult> {
    return {
      proposals: [
        {
          synthesisedText: 'Synthesis of the top questions',
          sourceQuestionIds: ranked.slice(0, 2).map((r) => r.id),
          rationale: 'Mock synthesis for end-to-end tests.',
        },
      ],
      model: 'mock',
      modelVersion: 'mock',
    }
  }
}

export function getProvider(): ReasoningProvider {
  const provider = process.env.REASONING_PROVIDER ?? 'ollama'
  const model = process.env.REASONING_MODEL ?? 'qwen2.5:7b'
  switch (provider) {
    case 'ollama':
      return new OllamaChatProvider({
        baseUrl: process.env.OLLAMA_URL ?? 'http://localhost:11434',
        model,
      })
    case 'ollama-cloud':
      return new OllamaChatProvider({
        baseUrl: process.env.OLLAMA_CLOUD_URL ?? 'https://ollama.com',
        model,
        apiKey: process.env.OLLAMA_API_KEY,
      })
    case 'openrouter':
      return new OpenRouterProvider({
        baseUrl: 'https://openrouter.ai/api/v1',
        model,
        apiKey: process.env.OPENROUTER_API_KEY ?? '',
      })
    case 'mock':
      return new MockProvider()
    default:
      throw new Error(`Unknown REASONING_PROVIDER: ${provider}`)
  }
}
