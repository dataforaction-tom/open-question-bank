'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { PageShell } from './PageShell'
import { Button } from './Button'

const links = [
  { href: '/admin/dashboard', label: 'Dashboard' },
  { href: '/admin/moderation', label: 'Moderation' },
  { href: '/admin/curation', label: 'Curation' },
  { href: '/admin/refinement', label: 'Refinement' },
  { href: '/admin/campaigns', label: 'Campaigns' },
]

// Shared chrome for the authenticated admin pages: cross-page nav (audit M1)
// with the active section highlighted, plus a single logout implementation.
export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' })
    router.push('/admin/login')
  }

  const nav = links.map((link) => {
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
  })

  return (
    <PageShell
      size="lg"
      nav={<>{nav}</>}
      actions={
        <Button variant="quiet" onClick={logout}>
          Log out
        </Button>
      }
    >
      {children}
    </PageShell>
  )
}
