import { describe, expect, it } from 'vitest'
import { initialRating, initialRatingWithDemand, demandPrior, MU0, update } from '@/lib/trueskill'

describe('initialRating', () => {
  it('is the TrueSkill default (25, 25/3)', () => {
    const r = initialRating()
    expect(r.mu).toBeCloseTo(25, 6)
    expect(r.sigma).toBeCloseTo(25 / 3, 6)
  })
})

describe('demandPrior', () => {
  it('returns 0 for zero or negative variant counts', () => {
    expect(demandPrior(0)).toBe(0)
    expect(demandPrior(-1)).toBe(0)
  })

  it('returns a positive boost for any non-zero count', () => {
    expect(demandPrior(1)).toBeGreaterThan(0)
    expect(demandPrior(10)).toBeGreaterThan(0)
  })

  it('has diminishing returns (logarithmic)', () => {
    // Equal steps: each +5 should add less than the previous +5.
    const b5 = demandPrior(5)
    const b10 = demandPrior(10)
    const b15 = demandPrior(15)
    const b20 = demandPrior(20)
    expect(b10 - b5).toBeGreaterThan(b15 - b10)
    expect(b15 - b10).toBeGreaterThan(b20 - b15)
  })
})

describe('initialRatingWithDemand', () => {
  it('returns the default rating when variantCount is 0', () => {
    const r = initialRatingWithDemand(0)
    expect(r.mu).toBeCloseTo(MU0, 6)
    expect(r.sigma).toBeCloseTo(25 / 3, 6)
  })

  it('shifts mu upward but keeps sigma unchanged', () => {
    const r = initialRatingWithDemand(5)
    expect(r.mu).toBeGreaterThan(MU0)
    expect(r.sigma).toBeCloseTo(25 / 3, 6)
  })
})

describe('update — decisive result', () => {
  it('matches the canonical default-vs-default outcome', () => {
    // Two fresh players; A beats B. Canonical TrueSkill numbers (draw prob 0.1,
    // beta=25/6, tau=25/300): winner ≈ (29.396, 7.171), loser ≈ (20.604, 7.171).
    const [w, l] = update(initialRating(), initialRating())
    expect(w.mu).toBeCloseTo(29.396, 1)
    expect(l.mu).toBeCloseTo(20.604, 1)
    expect(w.sigma).toBeCloseTo(7.171, 1)
    expect(l.sigma).toBeCloseTo(7.171, 1)
    // Winner rises, loser falls, both grow more certain.
    expect(w.mu).toBeGreaterThan(25)
    expect(l.mu).toBeLessThan(25)
    expect(w.sigma).toBeLessThan(25 / 3)
  })
})

describe('update — draw', () => {
  it('leaves equal players level but more certain', () => {
    const [a, b] = update(initialRating(), initialRating(), { draw: true })
    expect(a.mu).toBeCloseTo(25, 3)
    expect(b.mu).toBeCloseTo(25, 3)
    expect(a.sigma).toBeLessThan(25 / 3)
    expect(b.sigma).toBeLessThan(25 / 3)
  })
})

describe('update — mismatched skill', () => {
  it('moves a confident favourite far less on a win than an upset moves the underdog', () => {
    const favourite = { mu: 35, sigma: 3 }
    const underdog = { mu: 15, sigma: 3 }
    // Expected result: favourite barely moves.
    const [fav] = update(favourite, underdog)
    // Upset: the underdog wins instead — a big surprise, so it moves a lot.
    const [up] = update(underdog, favourite)
    expect(fav.mu - favourite.mu).toBeLessThan(up.mu - underdog.mu)
  })

  it('exercises the asymmetric draw path without producing NaN', () => {
    const [a, b] = update({ mu: 35, sigma: 4 }, { mu: 15, sigma: 4 }, { draw: true })
    expect(Number.isFinite(a.mu) && Number.isFinite(a.sigma)).toBe(true)
    expect(Number.isFinite(b.mu) && Number.isFinite(b.sigma)).toBe(true)
    // A draw is evidence the two are closer than their means suggest: the favourite
    // is dragged down, the underdog pulled up.
    expect(a.mu).toBeLessThan(35)
    expect(b.mu).toBeGreaterThan(15)
  })
})

describe('update — convergence', () => {
  it('shrinks sigma monotonically as a player keeps winning (the property pairing relies on)', () => {
    let winner = initialRating()
    let loser = initialRating()
    let prev = winner.sigma
    for (let i = 0; i < 5; i++) {
      ;[winner, loser] = update(winner, loser)
      expect(winner.sigma).toBeLessThan(prev)
      prev = winner.sigma
    }
  })
})
