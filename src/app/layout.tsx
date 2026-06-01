import type { ReactNode } from 'react'

export const metadata = {
  title: 'Question Bank',
  description: 'A collective intelligence and prioritisation tool for questions.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
