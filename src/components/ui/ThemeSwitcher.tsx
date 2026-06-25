'use client'

import { useEffect, useRef, useState } from 'react'
import { THEME_OPTIONS, type ThemePreference } from '@/lib/ui-theme'
import { useTheme } from './ThemeProvider'

// App-wide theme picker: a labelled trigger opening an accessible radio menu of
// the available themes. Rendered permanently in PageShell's header.
export function ThemeSwitcher() {
  const { preference, setPreference } = useTheme()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const activeLabel =
    THEME_OPTIONS.find((option) => option.id === preference)?.label ?? 'Theme'

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function choose(id: ThemePreference) {
    setPreference(id)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-muted hover:text-ink hover:bg-surface transition duration-150"
      >
        <span aria-hidden className="size-2.5 rounded-full bg-moss" />
        <span>{activeLabel}</span>
      </button>

      {open && (
        <ul
          role="menu"
          aria-label="Theme"
          className="absolute right-0 z-10 mt-1.5 min-w-44 rounded-md border border-line bg-paper py-1 shadow-lg"
        >
          {THEME_OPTIONS.map((option) => {
            const active = option.id === preference
            return (
              <li key={option.id} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => choose(option.id)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-surface ${
                    active ? 'text-moss font-medium' : 'text-ink'
                  }`}
                >
                  <span>{option.label}</span>
                  {active && <span aria-hidden>✓</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
