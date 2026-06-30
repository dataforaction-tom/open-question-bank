'use client'

import { useCallback, useEffect, useState } from 'react'
import { AdminShell } from '@/components/ui/AdminShell'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Label, Textarea } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { Stamp } from '@/components/ui/Stamp'
import { EmptyState } from '@/components/ui/EmptyState'

interface Clustered {
  id: string
  canonicalText: string
  createdAt: string
}

interface Critique {
  criterion: string
  verdict: 'pass' | 'fail'
  note: string
}

interface Suggestion {
  suggestedText: string
  critique: Critique[]
  criteriaApplied: string[]
  rationale: string
  model: string
  modelVersion: string
}

interface RefinementRow {
  id: string
  action: 'accept' | 'reject' | 'edit'
  before: string
  after: string | null
  timestamp: string
}

export default function RefinementPage() {
  const [questions, setQuestions] = useState<Clustered[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState<{ id: string; before: string; suggestion: Suggestion } | null>(null)
  const [editedText, setEditedText] = useState('')
  const [history, setHistory] = useState<RefinementRow[]>([])

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/questions?state=clustered')
    if (res.ok) setQuestions((await res.json()).questions)
  }, [])

  async function loadHistory(id: string) {
    const res = await fetch(`/api/admin/questions/${id}/refinements`)
    setHistory(res.ok ? (await res.json()).refinements : [])
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  async function suggest(id: string) {
    setBusy(true)
    setMessage('Asking the model…')
    try {
      const res = await fetch(`/api/admin/questions/${id}/refine/suggest`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setActive({ id, before: data.before, suggestion: data.suggestion })
        setEditedText(data.suggestion.suggestedText)
        setMessage('')
        loadHistory(id)
      } else {
        setMessage(data.error ?? 'Error')
      }
    } catch {
      setMessage('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function decide(action: 'accept' | 'reject' | 'edit') {
    if (!active) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/questions/${active.id}/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          before: active.before,
          llmSuggestedText: active.suggestion.suggestedText,
          finalText: action === 'reject' ? null : editedText,
          criteriaApplied: active.suggestion.criteriaApplied,
          critique: active.suggestion.critique,
          rationale: active.suggestion.rationale,
          model: active.suggestion.model,
          modelVersion: active.suggestion.modelVersion,
        }),
      })
      const data = await res.json()
      setMessage(res.ok ? `Recorded: ${action}.` : (data.error ?? 'Error'))
      if (res.ok) setActive(null)
    } catch {
      setMessage('Network error — please try again.')
    } finally {
      setBusy(false)
      load()
    }
  }

  return (
    <AdminShell>
      <div className="space-y-1">
        <p className="eyebrow">Refine</p>
        <h1 className="text-3xl">Refinement</h1>
        <p className="text-muted">
          Optional AI suggestions to improve a question&apos;s wording — use any time before it&apos;s
          marked ready.
        </p>
      </div>

      {message && (
        <Notice role="status" tone="info">
          {message}
        </Notice>
      )}

      {active ? (
        <section className="space-y-5">
          <Card className="space-y-1">
            <p className="eyebrow">Before</p>
            <p className="text-ink">{active.before}</p>
          </Card>

          <div className="space-y-1.5">
            <Label htmlFor="refined">Suggested (editable):</Label>
            <Textarea
              id="refined"
              className="min-h-24"
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
            />
          </div>

          <Card className="space-y-3">
            <p className="text-ink">
              <span className="font-medium">Rationale:</span> {active.suggestion.rationale}
            </p>
            <ul className="space-y-1.5 list-none p-0 text-sm">
              {active.suggestion.critique.map((c) => (
                <li key={c.criterion} className="flex gap-2">
                  <span
                    className={`font-mono text-xs uppercase tracking-wide ${
                      c.verdict === 'pass' ? 'text-moss' : 'text-clay'
                    }`}
                  >
                    {c.verdict}
                  </span>
                  <span className="text-ink">
                    {c.criterion} — {c.note}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="accent" onClick={() => decide('accept')} disabled={busy}>
              Accept
            </Button>
            <Button type="button" onClick={() => decide('edit')} disabled={busy}>
              Save edit
            </Button>
            <Button type="button" variant="ghost" onClick={() => decide('reject')} disabled={busy}>
              Reject
            </Button>
            <Button type="button" variant="quiet" onClick={() => setActive(null)} disabled={busy}>
              Cancel
            </Button>
          </div>

          {history.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted hover:text-ink">
                Refinement history ({history.length})
              </summary>
              <ul className="mt-2 space-y-1 list-none p-0">
                {history.map((h) => (
                  <li key={h.id}>
                    <Stamp>
                      [{h.action}] {h.before} → {h.after ?? '(rejected — unchanged)'}
                    </Stamp>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      ) : questions.length === 0 ? (
        <EmptyState>No questions ready for wording suggestions yet.</EmptyState>
      ) : (
        <ul className="space-y-3 list-none p-0">
          {questions.map((q) => (
            <li key={q.id}>
              <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 break-words text-ink">{q.canonicalText}</div>
                <Button
                  type="button"
                  className="shrink-0 self-start sm:self-auto"
                  onClick={() => suggest(q.id)}
                  disabled={busy}
                >
                  Suggest better wording
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </AdminShell>
  )
}
