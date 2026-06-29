import { Gaussian } from 'ts-gaussian'

export interface Rating {
  mu: number
  sigma: number
}

// Standard TrueSkill defaults.
export const MU0 = 25
export const SIGMA0 = 25 / 3
export const BETA = SIGMA0 / 2
export const TAU = SIGMA0 / 100
export const DRAW_PROBABILITY = 0.1

const N = new Gaussian(0, 1)
const EPS = 1e-10

export function initialRating(): Rating {
  return { mu: MU0, sigma: SIGMA0 }
}

/**
 * Community demand prior: adjust the initial mu upward based on how many
 * submissions merged into this question. The boost is logarithmic (diminishing
 * returns) so a question with 10 variants gets a meaningful but not dominant
 * head start. Sigma is unchanged — the demand signal reduces neither the
 * uncertainty nor the amount of comparison evidence needed.
 *
 * With the default MU0=25, BETA≈4.17: 1 variant ≈ +2.4, 5 ≈ +4.4, 10 ≈ +5.6.
 * These are small relative to the BETA spread, so pairwise comparisons can
 * easily override the prior.
 */
const DEMAND_PRIOR_SCALE = BETA / 2 // ≈ 2.08

export function demandPrior(variantCount: number): number {
  if (variantCount <= 0) return 0
  return DEMAND_PRIOR_SCALE * Math.log2(1 + variantCount)
}

export function initialRatingWithDemand(variantCount: number): Rating {
  return { mu: MU0 + demandPrior(variantCount), sigma: SIGMA0 }
}

// Draw margin for a 1v1 (one player per side): ppf((p+1)/2) * sqrt(2) * beta.
function drawMarginRaw(): number {
  return N.ppf((DRAW_PROBABILITY + 1) / 2) * Math.sqrt(2) * BETA
}

// Truncated-Gaussian correction functions (Herbrich/Moserware), on normalised
// t = Δμ/c and eps = drawMargin/c.
function vWin(t: number, eps: number): number {
  const denom = N.cdf(t - eps)
  if (denom < EPS) return -t + eps
  return N.pdf(t - eps) / denom
}
function wWin(t: number, eps: number): number {
  const denom = N.cdf(t - eps)
  if (denom < EPS) return t - eps < 0 ? 1 : 0
  const v = vWin(t, eps)
  return v * (v + t - eps)
}
function vDraw(t: number, eps: number): number {
  const a = Math.abs(t)
  const denom = N.cdf(eps - a) - N.cdf(-eps - a)
  if (denom < EPS) return t < 0 ? -t - eps : -t + eps
  const numer = N.pdf(-eps - a) - N.pdf(eps - a)
  return (t < 0 ? -1 : 1) * (numer / denom)
}
function wDraw(t: number, eps: number): number {
  const a = Math.abs(t)
  const denom = N.cdf(eps - a) - N.cdf(-eps - a)
  if (denom < EPS) return 1
  const v = vDraw(t, eps)
  return v * v + ((eps - a) * N.pdf(eps - a) - (-eps - a) * N.pdf(-eps - a)) / denom
}

function applyUpdate(r: Rating, c: number, signedV: number, w: number): Rating {
  const variance = r.sigma ** 2 + TAU ** 2
  const meanMultiplier = variance / c
  const stdDevMultiplier = variance / (c * c)
  return {
    mu: r.mu + meanMultiplier * signedV,
    sigma: Math.sqrt(variance * (1 - w * stdDevMultiplier)),
  }
}

/**
 * One 1v1 TrueSkill update. Returns [updatedWinner, updatedLoser]. For a draw,
 * pass { draw: true } — the winner/loser labelling is then arbitrary.
 */
export function update(winner: Rating, loser: Rating, opts: { draw?: boolean } = {}): [Rating, Rating] {
  const draw = opts.draw ?? false
  const c = Math.sqrt(winner.sigma ** 2 + loser.sigma ** 2 + 2 * BETA ** 2)
  const t = (winner.mu - loser.mu) / c
  const eps = drawMarginRaw() / c
  const v = draw ? vDraw(t, eps) : vWin(t, eps)
  const w = draw ? wDraw(t, eps) : wWin(t, eps)
  return [applyUpdate(winner, c, v, w), applyUpdate(loser, c, -v, w)]
}
