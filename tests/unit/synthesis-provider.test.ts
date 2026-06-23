import { describe, expect, it } from 'vitest'
import { MockProvider, synthesisResultSchema, buildSynthesisPrompt } from '@/lib/llm'

describe('MockProvider.synthesise', () => {
  it('returns a schema-valid proposal that cites real ranked ids', async () => {
    const ranked = [
      { id: 'id-a', canonicalText: 'Question A' },
      { id: 'id-b', canonicalText: 'Question B' },
    ]
    const result = await new MockProvider().synthesise(ranked)
    expect(result.model).toBe('mock')
    expect(() => synthesisResultSchema.parse(result)).not.toThrow()
    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0].sourceQuestionIds.every((id) => ['id-a', 'id-b'].includes(id))).toBe(true)
  })
})

describe('buildSynthesisPrompt', () => {
  it('lists each ranked question id and text', () => {
    const prompt = buildSynthesisPrompt([{ id: 'id-a', canonicalText: 'Question A' }])
    expect(prompt).toContain('id-a')
    expect(prompt).toContain('Question A')
  })
})
