import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PREFERENCE,
  THEME_OPTIONS,
  isThemePreference,
  resolveTheme,
} from '@/lib/ui-theme'

describe('ui-theme', () => {
  it('lists Auto first, then the three concrete themes', () => {
    expect(THEME_OPTIONS.map((option) => option.id)).toEqual([
      'auto',
      'warm-civic',
      'warm-civic-dark',
      'climate-barometer',
    ])
  })

  it('defaults to auto', () => {
    expect(DEFAULT_PREFERENCE).toBe('auto')
  })

  it('isThemePreference accepts every preference and rejects others', () => {
    for (const option of THEME_OPTIONS) expect(isThemePreference(option.id)).toBe(true)
    expect(isThemePreference('bananas')).toBe(false)
    expect(isThemePreference(null)).toBe(false)
    expect(isThemePreference(undefined)).toBe(false)
  })

  it('resolves auto to the Warm Civic light/dark pair via the OS flag', () => {
    expect(resolveTheme('auto', false)).toBe('warm-civic')
    expect(resolveTheme('auto', true)).toBe('warm-civic-dark')
  })

  it('passes concrete preferences through unchanged, ignoring the OS flag', () => {
    expect(resolveTheme('warm-civic', true)).toBe('warm-civic')
    expect(resolveTheme('warm-civic-dark', false)).toBe('warm-civic-dark')
    expect(resolveTheme('climate-barometer', true)).toBe('climate-barometer')
    expect(resolveTheme('climate-barometer', false)).toBe('climate-barometer')
  })
})
