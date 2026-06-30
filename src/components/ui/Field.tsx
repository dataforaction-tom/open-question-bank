import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

// Sits on `surface` so inputs stay distinct from the page in both light and dark.
// The moss focus ring comes from the global :focus-visible rule; the border warms
// toward sage on hover for a little affordance.
const fieldBase =
  'w-full rounded-md border border-line bg-surface px-3 py-2 text-ink ' +
  'placeholder:text-muted hover:border-sage transition-colors min-h-11'

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${fieldBase} ${className}`} {...props} />
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${fieldBase} leading-relaxed ${className}`} {...props} />
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${fieldBase} ${className}`} {...props} />
}

// Small-caps field label, associated to a control via htmlFor.
export function Label({ className = '', ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={`block text-sm font-medium text-muted mb-1.5 ${className}`}
      {...props}
    />
  )
}
