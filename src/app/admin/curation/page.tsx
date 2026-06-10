'use client'

import { useCallback, useEffect, useState } from 'react'

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
    <main style={{ maxWidth: 720, margin: '4rem auto', fontFamily: 'system-ui' }}>
      <h1>Curation</h1>
      {message && <p role="status">{message}</p>}

      {active ? (
        <section>
          <p>
            <strong>Question:</strong> {active.canonicalText}
          </p>
          <button type="button" onClick={score} disabled={busy}>
            Score definedness
          </button>{' '}
          <button type="button" onClick={promote} disabled={busy}>
            Promote to canonical
          </button>{' '}
          <button type="button" onClick={() => setActive(null)} disabled={busy}>
            Back
          </button>

          {current.length > 0 ? (
            <>
              <p>
                <strong>Average: {average}</strong> (advisory — promotion is your call)
              </p>
              <ul>
                {current.map((row) => (
                  <li key={row.criterion}>
                    {row.criterion}: {row.score} / 5 — {row.rationale}
                  </li>
                ))}
              </ul>
              {runCount > 1 && (
                <details>
                  <summary>Score history ({runCount} runs)</summary>
                  <ul>
                    {history.map((row) => (
                      <li key={row.id}>
                        [{new Date(row.timestamp).toLocaleString()}] {row.criterion}: {row.score} / 5 ({row.model})
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          ) : (
            <p>No scores yet — scoring is optional; you can promote without it.</p>
          )}
        </section>
      ) : questions.length === 0 ? (
        <p>No clustered questions to curate.</p>
      ) : (
        <ul>
          {questions.map((q) => (
            <li key={q.id} style={{ marginBottom: '1rem' }}>
              <div>{q.canonicalText}</div>
              <button type="button" onClick={() => open(q)} disabled={busy}>
                Curate
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
