import { BETA } from '@/lib/trueskill'

export interface Scored {
  questionId: string
  mu: number
  sigma: number
}

export interface Pairing {
  a: Scored
  b: Scored
  servedReason: string
}

// Below this, a question is "settled" — we stop serving pairs of two settled items.
export const SIGMA_STOP = 2.5

/** Stable, order-independent key for an unordered pair of question ids. */
export function pairKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`
}

// High when the two are close in skill AND we are still uncertain about them:
// closeness = exp(-Δμ² / 2c²), uncertainty weight = σa + σb. Note σ enters
// twice: as the linear weight AND inside cSq (the same denominator as the
// TrueSkill update), which widens the closeness window — so uncertain pairs are
// strongly preferred.
export function pairPriority(a: Scored, b: Scored): number {
  const cSq = 2 * BETA ** 2 + a.sigma ** 2 + b.sigma ** 2
  const closeness = Math.exp(-((a.mu - b.mu) ** 2) / (2 * cSq))
  return (a.sigma + b.sigma) * closeness
}

function reason(a: Scored, b: Scored): string {
  const gap = Math.abs(a.mu - b.mu).toFixed(2)
  const avgSigma = ((a.sigma + b.sigma) / 2).toFixed(1)
  return `closely matched (Δμ=${gap}) and still uncertain (σ≈${avgSigma})`
}

/**
 * Pick the most informative eligible pair. Deterministic: it serves the current
 * best pair, whose priority falls as its σ drops with each comparison — so the
 * served pair naturally rotates without explicit exploration. Returns null when
 * every pair is settled (the stop condition) or there are fewer than two items.
 * O(n²); sealed comparison sets are small.
 */
export function selectPair(
  candidates: Scored[],
  opts: { sigmaStop?: number; excludePairs?: Set<string> } = {},
): Pairing | null {
  const sigmaStop = opts.sigmaStop ?? SIGMA_STOP
  const excludePairs = opts.excludePairs
  let best: Pairing | null = null
  let bestScore = -Infinity
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]
      const b = candidates[j]
      if (a.sigma < sigmaStop && b.sigma < sigmaStop) continue
      if (excludePairs?.has(pairKey(a.questionId, b.questionId))) continue
      const score = pairPriority(a, b)
      if (score > bestScore) {
        bestScore = score
        best = { a, b, servedReason: reason(a, b) }
      }
    }
  }
  return best
}
