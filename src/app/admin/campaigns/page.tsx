'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AdminShell } from '@/components/ui/AdminShell'
import { Button, buttonClasses } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Label, Input, Select } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { EmptyState } from '@/components/ui/EmptyState'

interface CampaignRow {
  id: string
  prompt: string
  comparisonAxis: string
  state: string
}

// Curated presets for the judge-facing "Which is more ___?" comparison. The DB column stays
// free-text (comparisonAxis), so "Other" falls back to a custom value rather than being enforced.
const AXIS_PRESETS = [
  { value: 'important', label: 'Importance', description: 'Which question matters most to address?' },
  {
    value: 'impactful',
    label: 'Impact',
    description: 'Which question, if answered, would change the most for people?',
  },
  { value: 'urgent', label: 'Urgency', description: 'Which question needs answering soonest?' },
] as const
const CUSTOM_AXIS = '__custom__'

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [prompt, setPrompt] = useState('')
  const [axisChoice, setAxisChoice] = useState<string>(AXIS_PRESETS[0].value)
  const [customAxis, setCustomAxis] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const axis = axisChoice === CUSTOM_AXIS ? customAxis.trim() : axisChoice
  const selectedPreset = AXIS_PRESETS.find((p) => p.value === axisChoice)

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
        setAxisChoice(AXIS_PRESETS[0].value)
        setCustomAxis('')
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
        <p className="text-muted">Group ready questions into a set the public can compare and rank.</p>
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
            <Select
              id="axis"
              value={axisChoice}
              onChange={(e) => setAxisChoice(e.target.value)}
            >
              {AXIS_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
              <option value={CUSTOM_AXIS}>Other…</option>
            </Select>
            {axisChoice === CUSTOM_AXIS ? (
              <Input
                aria-label="Custom comparison axis"
                placeholder="e.g. feasible"
                value={customAxis}
                onChange={(e) => setCustomAxis(e.target.value)}
                required
              />
            ) : (
              selectedPreset && <p className="text-sm text-muted">{selectedPreset.description}</p>
            )}
            {axis && <p className="text-sm text-muted">Judges will see: &ldquo;Which is more {axis}?&rdquo;</p>}
          </div>
          <Button type="submit" disabled={busy || !axis}>
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
