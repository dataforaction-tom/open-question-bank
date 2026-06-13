import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { Fraunces, Public_Sans, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'

// Distinctive, civic type pairing — self-hosted by next/font (no runtime
// network call, which keeps the app local-first per the project's commitments).
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
})

const publicSans = Public_Sans({
  subsets: ['latin'],
  variable: '--font-public-sans',
  display: 'swap',
})

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Question Bank',
  description: 'A collective intelligence and prioritisation tool for questions.',
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbf7f0' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1714' },
  ],
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${publicSans.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
