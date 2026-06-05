import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildRefinementPrompt,
  OllamaChatProvider,
  ProviderError,
  refinementSuggestionSchema,
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
