import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'accent' | 'ghost' | 'quiet'

const base =
  'inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-md text-sm font-medium ' +
  'no-underline hover:no-underline transition duration-150 active:translate-y-px ' +
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:translate-y-0'

// Moss leads (primary); clay is the warm CTA pop; ghost/quiet are low-emphasis.
// Solid fills brighten on hover and dim on press; outlines fill toward surface.
const variants: Record<Variant, string> = {
  primary: 'bg-moss text-paper hover:brightness-110 active:brightness-95',
  accent: 'bg-clay text-paper hover:brightness-110 active:brightness-95',
  ghost: 'border border-line text-ink hover:bg-surface active:brightness-95',
  quiet: 'text-muted hover:text-ink hover:bg-surface',
}

// Shared so a <Link> can wear the same skin as a <button> (e.g. the hero CTA).
export function buttonClasses(variant: Variant = 'primary', extra = '') {
  return `${base} ${variants[variant]} ${extra}`
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return <button className={buttonClasses(variant, className)} {...props} />
}
