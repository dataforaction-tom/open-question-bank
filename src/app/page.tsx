import Link from 'next/link'

export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: '4rem auto', fontFamily: 'system-ui' }}>
      <h1>Question Bank</h1>
      <p>A collective intelligence and prioritisation tool for questions.</p>
      <p>
        <Link href="/submit">Submit a question →</Link>
      </p>
    </main>
  )
}
