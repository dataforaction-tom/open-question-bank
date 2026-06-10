import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildRefinementPrompt,
  buildScoringPrompt,
  MockProvider,
  OllamaChatProvider,
  OpenRouterProvider,
  ProviderError,
  refinementSuggestionSchema,
  scoreResultSchema,
  type ReasoningProvider,
} from '@/lib/llm'

afterEach(() => vi.restoreAllMocks())

const VALID = {
  suggestedText: 'What should UK secondary schools prioritise in 2026?',
  critique: [
    { criterion: 'specific', verdict: 'pass', note: 'concrete' },
    { criterion: 'scoped', verdict: 'fail', note: 'no timeframe' },
  ],
  criteriaApplied: ['scoped'],
  rationale: 'Added a timeframe to bound the question.',
}

function chatResponse(content: unknown) {
  return new Response(JSON.stringify({ message: { content: JSON.stringify(content) } }), {
    status: 200,
  })
}

describe('buildRefinementPrompt', () => {
  it('embeds all five rubric criteria and the question text', () => {
    const prompt = buildRefinementPrompt('How do we fix education?')
    for (const c of ['specific', 'answerable', 'scoped', 'non-leading', 'single-barrelled']) {
      expect(prompt).toContain(c)
    }
    expect(prompt).toContain('How do we fix education?')
  })
})

describe('refinementSuggestionSchema', () => {
  it('accepts a well-formed suggestion', () => {
    expect(() => refinementSuggestionSchema.parse(VALID)).not.toThrow()
  })
  it('rejects an unknown criterion', () => {
    expect(() => refinementSuggestionSchema.parse({ ...VALID, criteriaApplied: ['nope'] })).toThrow()
  })
})

describe('OllamaChatProvider', () => {
  it('posts to /api/chat (no auth for local) and returns a validated suggestion', async () => {
    const fetchMock = vi
      .fn()
      // first call: /api/chat ; second call: /api/tags for the digest
      .mockResolvedValueOnce(chatResponse(VALID))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ models: [{ name: 'qwen2.5:7b', digest: 'sha256:abc' }] }), {
          status: 200,
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const provider = new OllamaChatProvider({ baseUrl: 'http://localhost:11434', model: 'qwen2.5:7b' })
    const result = await provider.refine('How do we fix education?')

    expect(result.suggestedText).toBe(VALID.suggestedText)
    expect(result.model).toBe('qwen2.5:7b')
    expect(result.modelVersion).toBe('sha256:abc')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/api\/chat$/)
    expect(init.headers.Authorization).toBeUndefined()
  })

  it('sends a bearer token and records the model id as version (Ollama Cloud — no tags lookup)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse(VALID))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new OllamaChatProvider({
      baseUrl: 'https://ollama.com',
      model: 'qwen2.5:7b',
      apiKey: 'secret',
    })
    const result = await provider.refine('How do we fix education?')

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer secret')
    // Cloud skips /api/tags entirely and records the model id as the version.
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).endsWith('/api/tags'))).toBe(true)
    expect(result.modelVersion).toBe('qwen2.5:7b')
  })

  it('falls back to the model id when the digest cannot be resolved', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(chatResponse(VALID))
      .mockResolvedValueOnce(new Response('nope', { status: 500 })) // /api/tags fails
    vi.stubGlobal('fetch', fetchMock)

    const provider = new OllamaChatProvider({ baseUrl: 'http://localhost:11434', model: 'qwen2.5:7b' })
    const result = await provider.refine('How do we fix education?')
    expect(result.modelVersion).toBe('qwen2.5:7b')
  })

  it('retries once then throws ProviderError on malformed JSON', async () => {
    const bad = new Response(JSON.stringify({ message: { content: 'not json' } }), { status: 200 })
    const fetchMock = vi.fn().mockResolvedValue(bad)
    vi.stubGlobal('fetch', fetchMock)

    const provider = new OllamaChatProvider({ baseUrl: 'http://localhost:11434', model: 'qwen2.5:7b' })
    await expect(provider.refine('x')).rejects.toBeInstanceOf(ProviderError)
    // 2 attempts, each a single /api/chat call (digest never reached)
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/api/chat'))).toHaveLength(2)
  })
})

const VALID_SCORES = {
  scores: [
    { criterion: 'specific', score: 4, rationale: 'concrete ask' },
    { criterion: 'answerable', score: 5, rationale: 'evidence could settle it' },
    { criterion: 'scoped', score: 2, rationale: 'no timeframe or population' },
    { criterion: 'non-leading', score: 5, rationale: 'neutral framing' },
    { criterion: 'single-barrelled', score: 3, rationale: 'borderline second clause' },
  ],
}

describe('buildScoringPrompt', () => {
  it('embeds all five criteria, the 1–5 anchors, and the question text', () => {
    const prompt = buildScoringPrompt('How do we fix education?')
    for (const c of ['specific', 'answerable', 'scoped', 'non-leading', 'single-barrelled']) {
      expect(prompt).toContain(c)
    }
    expect(prompt).toContain('1 = clearly fails')
    expect(prompt).toContain('5 = clearly satisfies')
    expect(prompt).toContain('How do we fix education?')
  })
})

describe('scoreResultSchema', () => {
  it('accepts a well-formed result', () => {
    expect(() => scoreResultSchema.parse(VALID_SCORES)).not.toThrow()
  })
  it('rejects a missing criterion (only four entries)', () => {
    expect(() => scoreResultSchema.parse({ scores: VALID_SCORES.scores.slice(0, 4) })).toThrow()
  })
  it('rejects a duplicated criterion', () => {
    const dup = { scores: [...VALID_SCORES.scores.slice(0, 4), VALID_SCORES.scores[0]] }
    expect(() => scoreResultSchema.parse(dup)).toThrow()
  })
  it('rejects an out-of-range score', () => {
    const bad = { scores: VALID_SCORES.scores.map((s, i) => (i === 0 ? { ...s, score: 6 } : s)) }
    expect(() => scoreResultSchema.parse(bad)).toThrow()
  })
  it('rejects a non-integer score', () => {
    const bad = { scores: VALID_SCORES.scores.map((s, i) => (i === 0 ? { ...s, score: 3.5 } : s)) }
    expect(() => scoreResultSchema.parse(bad)).toThrow()
  })
})

describe('ChatProvider.score', () => {
  it('returns a validated result with provenance', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(chatResponse(VALID_SCORES))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ models: [{ name: 'qwen2.5:7b', digest: 'sha256:abc' }] }), {
          status: 200,
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const provider = new OllamaChatProvider({ baseUrl: 'http://localhost:11434', model: 'qwen2.5:7b' })
    const result = await provider.score('How do we fix education?')

    expect(result.scores).toHaveLength(5)
    expect(result.model).toBe('qwen2.5:7b')
    expect(result.modelVersion).toBe('sha256:abc')
  })

  it('retries once then throws ProviderError on an invalid payload', async () => {
    // Valid JSON transport-wise, but fails the contract (missing criteria).
    const fetchMock = vi.fn().mockResolvedValue(chatResponse({ scores: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new OllamaChatProvider({ baseUrl: 'http://localhost:11434', model: 'qwen2.5:7b' })
    await expect(provider.score('x')).rejects.toBeInstanceOf(ProviderError)
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/api/chat'))).toHaveLength(2)
  })
})

describe('MockProvider.score', () => {
  it('is deterministic: all five criteria, fixed scores and rationales', async () => {
    // Typed as the interface — exactly how production code consumes it via getProvider().
    const provider: ReasoningProvider = new MockProvider()
    const a = await provider.score('anything')
    const b = await provider.score('anything else')
    expect(a).toEqual(b)
    expect(a.scores).toHaveLength(5)
    expect(a.scores[0]).toEqual({ criterion: 'specific', score: 4, rationale: 'mock specific rationale' })
    expect(a.model).toBe('mock')
  })
})

describe('OpenRouterProvider', () => {
  it('posts to /chat/completions with bearer auth and records the model id as version', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(VALID) } }] }), {
        status: 200,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const provider = new OpenRouterProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-4o-mini',
      apiKey: 'or-key',
    })
    const result = await provider.refine('How do we fix education?')

    expect(result.suggestedText).toBe(VALID.suggestedText)
    expect(result.modelVersion).toBe('openai/gpt-4o-mini')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/chat\/completions$/)
    expect(init.headers.Authorization).toBe('Bearer or-key')
    // OpenRouter never calls /api/tags.
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).endsWith('/api/tags'))).toBe(true)
  })
})
