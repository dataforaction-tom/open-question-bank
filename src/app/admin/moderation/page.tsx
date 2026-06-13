'use client'

import { useCallback, useEffect, useState } from 'react'
import { AdminShell } from '@/components/ui/AdminShell'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { EmptyState } from '@/components/ui/EmptyState'

interface Pending {
  id: string
  canonicalText: string
  createdAt: string
}

export default function ModerationPage() {
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

  return (
    <AdminShell>
      <div className="space-y-1">
        <p className="eyebrow">Queue</p>
        <h1 className="text-3xl">Moderation queue</h1>
      </div>

      {message && (
        <Notice role="status" tone="info">
          {message}
        </Notice>
      )}

      {pending.length === 0 ? (
        <EmptyState>No pending questions.</EmptyState>
      ) : (
        <ul className="space-y-3 list-none p-0">
          {pending.map((q) => (
            <li key={q.id}>
              <Card className="space-y-3">
                <div className="break-words text-ink">{q.canonicalText}</div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="accent"
                    onClick={() => approve(q.id)}
                    disabled={busyId === q.id}
                  >
                    Approve
                  </Button>
                  <Input
                    aria-label={`Reject reason for ${q.id}`}
                    placeholder="reason (optional)"
                    className="flex-1 min-w-[12rem]"
                    value={reasons[q.id] ?? ''}
                    onChange={(e) => setReasons((r) => ({ ...r, [q.id]: e.target.value }))}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => reject(q.id)}
                    disabled={busyId === q.id}
                  >
                    Reject
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </AdminShell>
  )
}
