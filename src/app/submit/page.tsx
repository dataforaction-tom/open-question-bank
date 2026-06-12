'use client'

import { useState } from 'react'
import { PageShell } from '@/components/ui/PageShell'
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

export default function SubmitPage() {
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
        body: JSON.stringify(body),
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
    setMessage(result.status === 'created' ? 'Added as a new question.' : (result.error ?? 'Error'))
    setPhase('done')
  }

  async function chooseExisting(canonicalId: string) {
    const result = await post({ rawText: text, visibility, decision: { type: 'merge', canonicalId } })
    setMessage(result.status === 'merged' ? 'Linked to the existing question.' : (result.error ?? 'Error'))
    setPhase('done')
  }

  return (
    <PageShell>
      <div className="space-y-2">
        <p className="eyebrow">Add to the bank</p>
        <h1 className="text-3xl sm:text-4xl">Submit a question</h1>
      </div>

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
    </PageShell>
  )
}
