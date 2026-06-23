import { describe, expect, it } from 'vitest'
import { outcomeFor } from '@/lib/agenda'

const row = (winnerQuestionId: string | null) => ({ winnerQuestionId })

describe('outcomeFor', () => {
  it('won when this question is the winner', () => {
    expect(outcomeFor(row('q1'), 'q1')).toBe('won')
  })
  it('lost when the opponent is the winner', () => {
    expect(outcomeFor(row('q2'), 'q1')).toBe('lost')
  })
  it('drew when there is no winner', () => {
    expect(outcomeFor(row(null), 'q1')).toBe('drew')
  })
})
