'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { PageShell } from '@/components/ui/PageShell'
import { Button } from '@/components/ui/Button'
import { Input, Label } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'

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
    <PageShell size="sm">
      <div className="space-y-2">
        <p className="eyebrow">Curators only</p>
        <h1 className="text-3xl">Admin login</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <Button type="submit" disabled={busy || password.length === 0}>
          {busy ? 'Signing in…' : 'Log in'}
        </Button>
      </form>

      {error && (
        <Notice role="alert" tone="error">
          {error}
        </Notice>
      )}
    </PageShell>
  )
}
