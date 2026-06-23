import { describe, expect, it } from 'vitest'
import { validateSources } from '@/lib/synthesis'

describe('validateSources', () => {
  const members = new Set(['a', 'b', 'c'])

  it('keeps only ids that are members', () => {
    expect(validateSources(['a', 'x', 'b'], members)).toEqual(['a', 'b'])
  })
  it('dedupes while preserving first-seen order', () => {
    expect(validateSources(['b', 'a', 'b'], members)).toEqual(['b', 'a'])
  })
  it('returns [] when no id is a member', () => {
    expect(validateSources(['x', 'y'], members)).toEqual([])
  })
})
