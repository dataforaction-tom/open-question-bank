import type { HTMLAttributes } from 'react'

type Tone = 'info' | 'error'

const tones: Record<Tone, string> = {
  info: 'border-moss bg-moss/10',
  error: 'border-clay bg-clay/10',
}

interface NoticeProps extends HTMLAttributes<HTMLDivElement> {
  tone?: Tone
}

// Styled wrapper for feedback messages. The caller passes `role="status"` or
// `role="alert"` so assistive tech still announces them correctly (audit M2).
export function Notice({ tone = 'info', className = '', ...props }: NoticeProps) {
  return (
    <div
      className={`rounded-md border-l-4 px-3.5 py-2.5 text-sm text-ink ${tones[tone]} ${className}`}
      {...props}
    />
  )
}
