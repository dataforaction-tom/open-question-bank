import type { ReactNode } from 'react'
import Link from 'next/link'

type Size = 'sm' | 'md' | 'lg'

const widths: Record<Size, string> = {
  sm: 'max-w-md', // login
  md: 'max-w-2xl', // landing, submit
  lg: 'max-w-3xl', // admin queues
}

interface PageShellProps {
  children: ReactNode
  nav?: ReactNode
  actions?: ReactNode
  size?: Size
}

// App chrome: a warm header with the wordmark + optional nav/actions, and a
// measured `<main>` whose direct children stagger in on load (`.reveal`).
export function PageShell({ children, nav, actions, size = 'md' }: PageShellProps) {
  const width = widths[size]
  return (
    <div className="min-h-screen">
      <header className="border-b border-line">
        <div className={`mx-auto ${width} px-6 h-16 flex items-center justify-between`}>
          <Link
            href="/"
            className="font-display text-lg text-moss no-underline hover:no-underline"
          >
            Question Bank
          </Link>
          {(nav || actions) && (
            <nav className="flex items-center gap-5 text-sm">
              {nav}
              {actions}
            </nav>
          )}
        </div>
      </header>
      <main className={`reveal mx-auto ${width} px-6 py-12 space-y-6`}>{children}</main>
    </div>
  )
}
