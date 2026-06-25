/**
 * The visual appearance theme (the page skin) — distinct from question `themes.ts`,
 * which categorises questions. This module is the single source of truth for the
 * theme switcher: the selectable list, the stored-preference type, and the pure
 * resolver that maps a preference to the concrete theme written to `<html data-theme>`.
 */

// What the user can pick. `auto` follows the OS; the rest are concrete skins.
export const THEME_PREFERENCES = [
  'auto',
  'warm-civic',
  'warm-civic-dark',
  'climate-barometer',
] as const

export type ThemePreference = (typeof THEME_PREFERENCES)[number]

// What actually lands on `<html data-theme>` — `auto` is always resolved away.
export type ConcreteTheme = 'warm-civic' | 'warm-civic-dark' | 'climate-barometer'

// The switcher list, in display order.
export const THEME_OPTIONS: { id: ThemePreference; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'warm-civic', label: 'Warm Civic' },
  { id: 'warm-civic-dark', label: 'Warm Civic Dark' },
  { id: 'climate-barometer', label: 'Climate Barometer' },
]

export const STORAGE_KEY = 'theme'
export const DEFAULT_PREFERENCE: ThemePreference = 'auto'

export function isThemePreference(value: unknown): value is ThemePreference {
  return (
    typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value)
  )
}

/**
 * Pure mapping from a stored preference + the OS dark-mode flag to the concrete
 * theme. `prefersDark` is passed in (rather than read here) so this stays free of
 * any DOM dependency and is trivially testable. The no-flash script below mirrors
 * this logic — keep the two in sync.
 */
export function resolveTheme(pref: ThemePreference, prefersDark: boolean): ConcreteTheme {
  if (pref === 'auto') return prefersDark ? 'warm-civic-dark' : 'warm-civic'
  return pref
}

/**
 * Runs inline in <head> before first paint: read the saved preference, resolve it
 * against the OS, and set `data-theme` so the page never flashes the wrong skin.
 * Self-contained (no imports) because it executes before the bundle loads. Mirrors
 * resolveTheme() / DEFAULT_PREFERENCE — update both together.
 */
export const NO_FLASH_SCRIPT = `(function(){try{` +
  `var valid=${JSON.stringify(THEME_PREFERENCES)};` +
  `var p=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});` +
  `if(valid.indexOf(p)<0)p=${JSON.stringify(DEFAULT_PREFERENCE)};` +
  `var dark=window.matchMedia('(prefers-color-scheme: dark)').matches;` +
  `var t=p==='auto'?(dark?'warm-civic-dark':'warm-civic'):p;` +
  `document.documentElement.dataset.theme=t;` +
  `}catch(e){document.documentElement.dataset.theme='warm-civic';}})()`
