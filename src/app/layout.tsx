import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { Fraunces, Public_Sans, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/components/ui/ThemeProvider'
import { NO_FLASH_SCRIPT } from '@/lib/ui-theme'

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
      <head>
        {/* Apply the saved theme before paint so the page never flashes the wrong skin. */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
