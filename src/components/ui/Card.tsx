import type { HTMLAttributes } from 'react'

// A single warm surface — no nested cards (audit guideline).
export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-lg border border-line bg-surface p-5 ${className}`}
      {...props}
    />
  )
}
