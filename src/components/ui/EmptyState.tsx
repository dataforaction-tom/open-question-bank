import type { ReactNode } from 'react'

// A calm, intentional "nothing here yet" panel — consistent across the admin
// queues instead of bare one-line text.
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-12 text-center text-muted">
      {children}
    </div>
  )
}
