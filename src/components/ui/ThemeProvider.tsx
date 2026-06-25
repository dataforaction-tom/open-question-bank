'use client'

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import {
  DEFAULT_PREFERENCE,
  STORAGE_KEY,
  isThemePreference,
  resolveTheme,
  type ThemePreference,
} from '@/lib/ui-theme'

interface ThemeContextValue {
  preference: ThemePreference
  setPreference: (next: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/*
 * The preference lives in a tiny external store backed by localStorage, read via
 * useSyncExternalStore. That keeps server and first-paint renders on the default
 * (no hydration mismatch) and avoids a setState-in-effect; React re-renders with
 * the stored value immediately after hydration.
 */
const listeners = new Set<() => void>()
let cachedPreference: ThemePreference | null = null

function getSnapshot(): ThemePreference {
  if (cachedPreference === null) {
    const stored = localStorage.getItem(STORAGE_KEY)
    cachedPreference = isThemePreference(stored) ? stored : DEFAULT_PREFERENCE
  }
  return cachedPreference
}

function getServerSnapshot(): ThemePreference {
  return DEFAULT_PREFERENCE
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function writePreference(next: ThemePreference) {
  cachedPreference = next
  localStorage.setItem(STORAGE_KEY, next)
  listeners.forEach((listener) => listener())
}

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

// Apply the resolved theme to <html>; the inline no-flash script already did this
// for the first paint, so this just keeps it in sync as the preference changes.
function applyTheme(preference: ThemePreference) {
  document.documentElement.dataset.theme = resolveTheme(preference, prefersDark())
}

/**
 * Owns the theme preference: reads it from localStorage, applies the resolved
 * theme to <html>, and — while the preference is `auto` — follows live OS
 * light/dark changes. Exposes `{ preference, setPreference }` to descendants.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  // Keep <html data-theme> aligned with the active preference.
  useEffect(() => {
    applyTheme(preference)
  }, [preference])

  // While on `auto`, re-resolve when the OS flips light/dark.
  useEffect(() => {
    if (preference !== 'auto') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('auto')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [preference])

  const setPreference = useCallback((next: ThemePreference) => {
    writePreference(next)
  }, [])

  return (
    <ThemeContext.Provider value={{ preference, setPreference }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within a ThemeProvider')
  return context
}
