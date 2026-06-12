'use client'

import { useCallback, useEffect, useState } from 'react'
import { AdminShell } from '@/components/ui/AdminShell'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Notice } from '@/components/ui/Notice'
import { Stamp } from '@/components/ui/Stamp'
import { EmptyState } from '@/components/ui/EmptyState'

interface Clustered {
  id: string
  canonicalText: string
  createdAt: string
}

interface ScoreRow {
  id: string
  criterion: string
  score: number
  rationale: string
  model: string
  modelVersion: string
  timestamp: string
}

export default function CurationPage() {
  const [questions, setQuestions] = useState<Clustered[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState<Clustered | null>(null)
  const [current, setCurrent] = useState<ScoreRow[]>([])
  const [history, setHistory] = useState<ScoreRow[]>([])

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/questions?state=clustered')
    if (res.ok) setQuestions((await res.json()).questions)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  async function loadScores(id: string) {
    const res = await fetch(`/api/admin/questions/${id}/scores`)
    if (res.ok) {
      const data = await res.json()
      setCurrent(data.current)
      setHistory(data.history)
    }
  }

  async function open(q: Clustered) {
    setActive(q)
    setCurrent([])
    setHistory([])
    setMessage('')
    await loadScores(q.id)
  }

  async function score() {
    if (!active) return
    setBusy(true)
    setMessage('Asking the model…')
    try {
      const res = await fetch(`/api/admin/questions/${active.id}/score`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setMessage('')
        await loadScores(active.id)
      } else {
        setMessage(data.error ?? 'Error')
      }
    } catch {
      setMessage('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function promote() {
    if (!active) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/questions/${active.id}/promote`, { method: 'POST' })
      const data = await res.json()
      setMessage(res.ok ? 'Promoted to canonical.' : (data.error ?? 'Error'))
      if (res.ok) setActive(null)
    } catch {
      setMessage('Network error — please try again.')
    } finally {
      setBusy(false)
      load()
    }
  }

  const average =
    current.length > 0
      ? (current.reduce((sum, row) => sum + row.score, 0) / current.length).toFixed(1)
      : null

  // One scoring run = one shared timestamp (rows insert in a single statement).
  const runCount = new Set(history.map((row) => row.timestamp)).size

  return (
    <AdminShell>
      <div className="space-y-1">
        <p className="eyebrow">Curate</p>
        <h1 className="text-3xl">Curation</h1>
      </div>

      {message && (
        <Notice role="status" tone="info">
          {message}
        </Notice>
      )}

      {active ? (
        <section className="space-y-5">
          <Card className="space-y-2">
            <p className="eyebrow">Question</p>
            <p className="text-lg text-ink">{active.canonicalText}</p>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={score} disabled={busy}>
              Score definedness
            </Button>
            <Button type="button" variant="accent" onClick={promote} disabled={busy}>
              Promote to canonical
            </Button>
            <Button type="button" variant="quiet" onClick={() => setActive(null)} disabled={busy}>
              Back
            </Button>
          </div>

          {current.length > 0 ? (
            <Card className="space-y-3">
              <p className="text-ink">
                <span className="font-medium">Average: {average}</span>{' '}
                <span className="text-muted">(advisory — promotion is your call)</span>
              </p>
              <ul className="space-y-2 list-none p-0">
                {current.map((row) => (
                  <li key={row.criterion} className="text-sm text-ink">
                    {row.criterion}: {row.score} / 5 — {row.rationale}
                  </li>
                ))}
              </ul>
              {runCount > 1 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted hover:text-ink">
                    Score history ({runCount} runs)
                  </summary>
                  <ul className="mt-2 space-y-1 list-none p-0">
                    {history.map((row) => (
                      <li key={row.id}>
                        <Stamp>
                          [{new Date(row.timestamp).toLocaleString()}] {row.criterion}: {row.score} / 5 ({row.model})
                        </Stamp>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Card>
          ) : (
            <p className="text-muted">
              No scores yet — scoring is optional; you can promote without it.
            </p>
          )}
        </section>
      ) : questions.length === 0 ? (
        <EmptyState>No clustered questions to curate.</EmptyState>
      ) : (
        <ul className="space-y-3 list-none p-0">
          {questions.map((q) => (
            <li key={q.id}>
              <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 break-words text-ink">{q.canonicalText}</div>
                <Button
                  type="button"
                  className="shrink-0 self-start sm:self-auto"
                  onClick={() => open(q)}
                  disabled={busy}
                >
                  Curate
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </AdminShell>
  )
}
