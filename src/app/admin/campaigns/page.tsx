'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AdminShell } from '@/components/ui/AdminShell'
import { Button, buttonClasses } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Label, Input } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { EmptyState } from '@/components/ui/EmptyState'

interface CampaignRow {
  id: string
  prompt: string
  comparisonAxis: string
  state: string
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [prompt, setPrompt] = useState('')
  const [axis, setAxis] = useState('importance')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/campaigns')
    if (res.ok) setCampaigns((await res.json()).campaigns)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const res = await fetch('/api/admin/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, comparisonAxis: axis }),
      })
      const data = await res.json()
      if (res.ok) {
        setPrompt('')
        await load()
      } else {
        setMessage(data.error ?? 'Error')
      }
    } catch {
      setMessage('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminShell>
      <div className="space-y-1">
        <p className="eyebrow">Prioritise</p>
        <h1 className="text-3xl">Campaigns</h1>
      </div>

      {message && (
        <Notice role="alert" tone="error">
          {message}
        </Notice>
      )}

      <Card>
        <form onSubmit={create} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="prompt">Prompt</Label>
            <Input
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Most important questions about…"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="axis">Comparison axis</Label>
            <Input id="axis" value={axis} onChange={(e) => setAxis(e.target.value)} required />
          </div>
          <Button type="submit" disabled={busy}>
            Create campaign
          </Button>
        </form>
      </Card>

      {campaigns.length === 0 ? (
        <EmptyState>No campaigns yet — create one above.</EmptyState>
      ) : (
        <ul className="space-y-3 list-none p-0">
          {campaigns.map((c) => (
            <li key={c.id}>
              <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="break-words text-ink">{c.prompt}</div>
                  <div className="text-sm text-muted">
                    {c.comparisonAxis} · {c.state}
                  </div>
                </div>
                <Link
                  href={`/admin/campaigns/${c.id}`}
                  className={buttonClasses('ghost', 'shrink-0 self-start sm:self-auto')}
                >
                  Open
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </AdminShell>
  )
}
