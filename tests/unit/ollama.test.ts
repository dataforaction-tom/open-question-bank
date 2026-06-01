import { afterEach, describe, expect, it, vi } from 'vitest'
import { embed, getModelDigest } from '@/lib/ollama'

afterEach(() => vi.restoreAllMocks())

describe('embed', () => {
  it('posts to /api/embed and returns the first embedding vector', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ embeddings: [[0.1, 0.2, 0.3]] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await embed('hello', 'nomic-embed-text')

    expect(result).toEqual([0.1, 0.2, 0.3])
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/api\/embed$/)
    expect(JSON.parse(init.body)).toEqual({ model: 'nomic-embed-text', input: 'hello' })
  })

  it('throws on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })))
    await expect(embed('hi', 'nomic-embed-text')).rejects.toThrow(/Ollama embed failed/)
  })
})

describe('getModelDigest', () => {
  it('returns the digest for the named model from /api/tags', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ models: [{ name: 'nomic-embed-text:latest', digest: 'sha256:abc' }] }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const digest = await getModelDigest('nomic-embed-text')

    expect(digest).toBe('sha256:abc')
  })
})
