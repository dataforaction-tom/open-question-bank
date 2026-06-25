/**
 * Pure number→language mappings for the public agenda (spec §3). Every tunable threshold lives
 * here. The page derives all plain-language presentation from the agenda's existing
 * mu/sigma/nComparisons fields — no backend change.
 */

export type ConfidenceLevel = 'firm' | 'moderate' | 'tentative'

const BAR_FLOOR = 8

/** Relative bar length: a question's score as a % of the top score (mu max), with a visible
 *  floor so the lowest item still shows. Integer 0–100. Relative, never an absolute value. */
export function strengthPercent(mu: number, max: number): number {
  if (max <= 0) return 100 // all-equal / zero — treat as full rather than divide by zero
  const pct = Math.round((mu / max) * 100)
  return Math.min(100, Math.max(BAR_FLOOR, pct))
}

/** Plain standing label from rank + strength ratio (mu/max, 0–1). Rank 1 always leads. */
export function standingLabel(rank: number, ratio: number): string {
  if (rank === 1) return 'Clear favourite'
  if (ratio >= 0.7) return 'Strong support'
  if (ratio >= 0.5) return 'Solid support'
  if (ratio >= 0.3) return 'Some support'
  return 'Limited support'
}

/** Settledness from TrueSkill sigma (smaller = more settled). */
export function confidenceLevel(sigma: number): ConfidenceLevel {
  if (sigma <= 3.5) return 'firm'
  if (sigma <= 5) return 'moderate'
  return 'tentative'
}

/** Filled-dot count (of 3) + an accessible one-sentence description. */
export function confidenceMeter(level: ConfidenceLevel): { filled: number; label: string } {
  switch (level) {
    case 'firm':
      return { filled: 3, label: 'Confidence: firm — settled by enough comparisons' }
    case 'moderate':
      return { filled: 2, label: 'Confidence: moderate — fairly settled' }
    case 'tentative':
      return { filled: 1, label: 'Confidence: tentative — still few comparisons' }
  }
}

/** Evidence outcome → plain phrase. */
export function outcomePhrase(outcome: 'won' | 'lost' | 'drew'): string {
  if (outcome === 'won') return 'Chosen over'
  if (outcome === 'lost') return 'Lost to'
  return 'Tied with'
}
