'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function AdminLoginPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        router.push('/admin/moderation')
      } else {
        setError('Invalid password.')
      }
    } catch {
      setError('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ maxWidth: 360, margin: '4rem auto', fontFamily: 'system-ui' }}>
      <h1>Admin login</h1>
      <form onSubmit={handleSubmit}>
        <label>
          Password{' '}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>{' '}
        <button type="submit" disabled={busy || password.length === 0}>
          {busy ? 'Signing in…' : 'Log in'}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </main>
  )
}
