'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/', label: 'Home' },
  { href: '/submit', label: 'Submit' },
  { href: '/campaigns', label: 'Campaigns' },
  { href: '/questions', label: 'Questions' },
]

// Public header nav (mirrors AdminShell's nav styling), passed into PageShell's `nav` slot.
export function PublicNav() {
  const pathname = usePathname()
  return (
    <>
      {links.map((link) => {
        const active = pathname === link.href
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={`no-underline hover:no-underline ${
              active ? 'text-moss font-medium' : 'text-muted hover:text-ink'
            }`}
          >
            {link.label}
          </Link>
        )
      })}
    </>
  )
}
