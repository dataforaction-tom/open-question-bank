import { describe, expect, it } from 'vitest'
import { pairKey, selectPair, SIGMA_STOP } from '@/lib/pairing'

const s = (questionId: string, mu: number, sigma: number) => ({ questionId, mu, sigma })

describe('selectPair', () => {
  it('returns null with fewer than two candidates', () => {
    expect(selectPair([])).toBeNull()
    expect(selectPair([s('a', 25, 8)])).toBeNull()
  })

  it('prefers the closest pair when uncertainty is equal', () => {
    const pair = selectPair([s('a', 25, 8), s('b', 25.5, 8), s('c', 45, 8)])
    expect(pair).not.toBeNull()
    expect(new Set([pair!.a.questionId, pair!.b.questionId])).toEqual(new Set(['a', 'b']))
  })

  it('skips pairs where both are already settled', () => {
    const low = SIGMA_STOP - 0.5
    expect(selectPair([s('a', 25, low), s('b', 25, low)])).toBeNull()
  })

  it('still serves an unsettled question against a settled one', () => {
    const low = SIGMA_STOP - 0.5
    const pair = selectPair([s('a', 25, low), s('b', 25, low), s('c', 25, 8)])
    expect(pair).not.toBeNull()
    expect([pair!.a.questionId, pair!.b.questionId]).toContain('c')
  })

  it('prefers the more uncertain pair when closeness is comparable', () => {
    // (a,c) are slightly further apart than (a,b) but far more uncertain — the
    // uncertainty axis should win, so c is served, not b.
    const pair = selectPair([s('a', 25, 8), s('b', 25, 3), s('c', 25.1, 8)])
    expect([pair!.a.questionId, pair!.b.questionId]).toContain('c')
  })

  it('explains why the pair was served', () => {
    const pair = selectPair([s('a', 25, 8), s('b', 26, 8)])
    expect(pair!.servedReason).toMatch(/Δμ=/)
  })

  it('skips an excluded (already-judged) pair', () => {
    const exclude = new Set([pairKey('a', 'b')])
    const pair = selectPair([s('a', 25, 8), s('b', 25, 8)], { excludePairs: exclude })
    expect(pair).toBeNull()
  })

  it('serves a different pair when the top pair is excluded', () => {
    const exclude = new Set([pairKey('a', 'b')])
    const pair = selectPair([s('a', 25, 8), s('b', 25, 8), s('c', 25, 8)], { excludePairs: exclude })
    expect(pair).not.toBeNull()
    const key = pairKey(pair!.a.questionId, pair!.b.questionId)
    expect(key).not.toBe(pairKey('a', 'b'))
  })
})

describe('pairKey', () => {
  it('is order-independent', () => {
    expect(pairKey('a', 'b')).toBe(pairKey('b', 'a'))
  })
})
