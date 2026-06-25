/**
 * The single source of truth for question themes (spec §2). Stored verbatim in
 * `question.theme` (nullable text — no enum migration, so adding a theme later is cheap).
 * `Unsorted` is a display-only bucket for questions whose theme is null/unknown; it is
 * deliberately NOT a member of THEMES.
 */
export const THEMES = [
  'Transport & Streets',
  'Housing',
  'Climate & Environment',
  'Health & Care',
  'Youth & Education',
  'Local Economy',
  'Community & Belonging',
  'Democracy & Voice',
  'Digital & Services',
] as const

export type Theme = (typeof THEMES)[number]

export const UNSORTED = 'Unsorted'

export function isTheme(value: string | null | undefined): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}
