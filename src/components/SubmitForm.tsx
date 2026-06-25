'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Textarea } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'

interface Candidate {
  id: string
  canonicalText: string
  distance: number
}

type Phase = 'editing' | 'choosing' | 'done'

/**
 * The submit + dedup-at-source ("yours or new?") flow, shared by the global submit page and the
 * per-campaign submit page. When `campaignId` is set, the question is submitted INTO that campaign
 * (a curation signal — it still goes through moderation).
 */
export function SubmitForm({ campaignId }: { campaignId?: string }) {
  const [text, setText] = useState('')
  const [visibility, setVisibility] = useState<'anonymous' | 'public'>('public')
  const [phase, setPhase] = useState<Phase>('editing')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function post(body: Record<string, unknown>) {
    setBusy(true)
    try {
      const res = await fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(campaignId ? { ...body, campaignId } : body),
      })
      return await res.json()
    } catch {
      return { error: 'Network error — please try again.' }
    } finally {
      setBusy(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const result = await post({ rawText: text, visibility })
    if (result.status === 'candidates') {
      setCandidates(result.candidates)
      setPhase('choosing')
    } else if (result.status === 'created') {
      setMessage('Thanks — your question was added.')
      setPhase('done')
    } else {
      setMessage(result.error ?? 'Something went wrong.')
    }
  }

  async function chooseNew() {
    const result = await post({ rawText: text, visibility, decision: { type: 'new' } })
    if (result.status === 'created') {
      setMessage('Added as a new question.')
      setPhase('done')
    } else {
      // Stay in 'choosing' so the failure renders as an error alert, not a success notice.
      setMessage(result.error ?? 'Something went wrong.')
    }
  }

  async function chooseExisting(canonicalId: string) {
    const result = await post({ rawText: text, visibility, decision: { type: 'merge', canonicalId } })
    if (result.status === 'merged') {
      setMessage('Linked to the existing question.')
      setPhase('done')
    } else {
      setMessage(result.error ?? 'Something went wrong.')
    }
  }

  return (
    <>
      {phase === 'editing' && (
        <form onSubmit={handleSubmit} className="space-y-5">
          <Textarea
            aria-label="Your question"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="What do you want this community to figure out together?"
            required
          />

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-muted">Visibility</legend>
            <div className="flex gap-5 text-sm">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="visibility"
                  className="accent-[var(--moss)]"
                  checked={visibility === 'public'}
                  onChange={() => setVisibility('public')}
                />
                Public
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="visibility"
                  className="accent-[var(--moss)]"
                  checked={visibility === 'anonymous'}
                  onChange={() => setVisibility('anonymous')}
                />
                Anonymous
              </label>
            </div>
          </fieldset>

          <Button type="submit" variant="accent" disabled={busy || text.trim().length === 0}>
            {busy ? 'Checking…' : 'Submit'}
          </Button>
        </form>
      )}

      {phase === 'choosing' && (
        <section className="space-y-4">
          <h2 className="text-xl">Is your question one of these, or new?</h2>
          <ul className="space-y-3 list-none p-0">
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0 break-words text-ink">{candidate.canonicalText}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    className="shrink-0 self-start sm:self-auto"
                    onClick={() => chooseExisting(candidate.id)}
                    disabled={busy}
                  >
                    This is mine
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
          <Button type="button" onClick={chooseNew} disabled={busy}>
            None of these — mine is new
          </Button>
        </section>
      )}

      {phase === 'done' && (
        <Notice role="status" tone="info">
          {message}
        </Notice>
      )}
      {phase !== 'done' && message && (
        <Notice role="alert" tone="error">
          {message}
        </Notice>
      )}
    </>
  )
}
