import type { HTMLAttributes } from 'react'

// Monospace provenance line (model · actor · timestamp, scores, ids) — makes the
// append-only-log ethos a visible design motif. Uses `muted` (not the lighter
// `sage`) so small metadata text still clears WCAG AA contrast.
export function Stamp({ className = '', ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={`font-mono text-xs text-muted tracking-tight ${className}`}
      {...props}
    />
  )
}
