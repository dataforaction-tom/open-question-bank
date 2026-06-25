import { describe, expect, it } from 'vitest'
import { THEMES, isTheme, UNSORTED } from '@/lib/themes'

describe('themes', () => {
  it('has the nine fixed labels', () => {
    expect(THEMES).toEqual([
      'Transport & Streets',
      'Housing',
      'Climate & Environment',
      'Health & Care',
      'Youth & Education',
      'Local Economy',
      'Community & Belonging',
      'Democracy & Voice',
      'Digital & Services',
    ])
  })

  it('isTheme accepts every label and rejects others', () => {
    for (const t of THEMES) expect(isTheme(t)).toBe(true)
    expect(isTheme('Bananas')).toBe(false)
    expect(isTheme(null)).toBe(false)
    expect(isTheme(undefined)).toBe(false)
    expect(isTheme(UNSORTED)).toBe(false) // Unsorted is a display bucket, not a theme
  })
})
