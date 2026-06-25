// tests/unit/agenda-presentation.test.ts
import { describe, expect, it } from 'vitest'
import {
  strengthPercent,
  standingLabel,
  confidenceLevel,
  confidenceMeter,
  outcomePhrase,
} from '@/lib/agenda-presentation'

describe('strengthPercent', () => {
  it('is 100 at the top score and proportional below it', () => {
    expect(strengthPercent(30, 30)).toBe(100)
    expect(strengthPercent(15, 30)).toBe(50)
  })
  it('applies an 8% visible floor', () => {
    expect(strengthPercent(1, 30)).toBe(8) // round(3.3) -> floored
    expect(strengthPercent(-5, 30)).toBe(8) // negative -> floored
  })
  it('guards a non-positive max (all-equal or zero) as full', () => {
    expect(strengthPercent(0, 0)).toBe(100)
    expect(strengthPercent(25, 0)).toBe(100)
  })
})

describe('standingLabel', () => {
  it('rank 1 is always the clear favourite', () => {
    expect(standingLabel(1, 1)).toBe('Clear favourite')
    expect(standingLabel(1, 0.1)).toBe('Clear favourite')
  })
  it('bands the rest by ratio', () => {
    expect(standingLabel(2, 0.7)).toBe('Strong support')
    expect(standingLabel(2, 0.69)).toBe('Solid support')
    expect(standingLabel(2, 0.5)).toBe('Solid support')
    expect(standingLabel(2, 0.49)).toBe('Some support')
    expect(standingLabel(2, 0.3)).toBe('Some support')
    expect(standingLabel(2, 0.29)).toBe('Limited support')
  })
})

describe('confidenceLevel', () => {
  it('bands sigma at 3.5 and 5', () => {
    expect(confidenceLevel(3.5)).toBe('firm')
    expect(confidenceLevel(3.51)).toBe('moderate')
    expect(confidenceLevel(5)).toBe('moderate')
    expect(confidenceLevel(5.01)).toBe('tentative')
  })
})

describe('confidenceMeter', () => {
  it('maps levels to dot counts and an accessible label', () => {
    expect(confidenceMeter('firm')).toEqual({ filled: 3, label: 'Confidence: firm — settled by enough comparisons' })
    expect(confidenceMeter('moderate')).toEqual({ filled: 2, label: 'Confidence: moderate — fairly settled' })
    expect(confidenceMeter('tentative')).toEqual({ filled: 1, label: 'Confidence: tentative — still few comparisons' })
  })
})

describe('outcomePhrase', () => {
  it('renders each outcome in plain language', () => {
    expect(outcomePhrase('won')).toBe('Chosen over')
    expect(outcomePhrase('lost')).toBe('Lost to')
    expect(outcomePhrase('drew')).toBe('Tied with')
  })
})
