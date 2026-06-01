'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

interface Pending {
  id: string
  canonicalText: string
  createdAt: string
}

export default function ModerationPage() {
  const router = useRouter()
  const [pending, setPending] = useState<Pending[]>([])
  const [message, setMessage] = useState('')
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/questions?state=submitted')
    if (res.ok) {
      const data = await res.json()
      setPending(data.questions)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  async function approve(id: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/questions/${id}/approve`, { method: 'POST' })
      const data = await res.json()
      setMessage(
        res.ok
          ? data.created
            ? 'Approved — formed a new cluster.'
            : 'Approved — joined an existing cluster.'
          : (data.error ?? 'Error'),
      )
    } catch {
      setMessage('Network error — please try again.')
    } finally {
      setBusyId(null)
      load()
    }
  }

  async function reject(id: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/questions/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reasons[id] ?? '' }),
      })
      const data = await res.json()
      setMessage(res.ok ? 'Rejected.' : (data.error ?? 'Error'))
    } catch {
      setMessage('Network error — please try again.')
    } finally {
      setBusyId(null)
      load()
    }
  }

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' })
    router.push('/admin/login')
  }

  return (
    <main style={{ maxWidth: 720, margin: '4rem auto', fontFamily: 'system-ui' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h1>Moderation queue</h1>
        <button type="button" onClick={logout}>
          Log out
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      {pending.length === 0 ? (
        <p>No pending questions.</p>
      ) : (
        <ul>
          {pending.map((q) => (
            <li key={q.id} style={{ marginBottom: '1rem' }}>
              <div>{q.canonicalText}</div>
              <button type="button" onClick={() => approve(q.id)} disabled={busyId === q.id}>
                Approve
              </button>{' '}
              <input
                aria-label={`Reject reason for ${q.id}`}
                placeholder="reason (optional)"
                value={reasons[q.id] ?? ''}
                onChange={(e) => setReasons((r) => ({ ...r, [q.id]: e.target.value }))}
              />{' '}
              <button type="button" onClick={() => reject(q.id)} disabled={busyId === q.id}>
                Reject
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
