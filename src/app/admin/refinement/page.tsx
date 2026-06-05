'use client'

import { useCallback, useEffect, useState } from 'react'

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
    <main style={{ maxWidth: 720, margin: '4rem auto', fontFamily: 'system-ui' }}>
      <h1>Refinement</h1>
      {message && <p role="status">{message}</p>}

      {active ? (
        <section>
          <p>
            <strong>Before:</strong> {active.before}
          </p>
          <label htmlFor="refined">
            <strong>Suggested (editable):</strong>
          </label>
          <textarea
            id="refined"
            style={{ width: '100%', minHeight: '4rem' }}
            value={editedText}
            onChange={(e) => setEditedText(e.target.value)}
          />
          <p>
            <strong>Rationale:</strong> {active.suggestion.rationale}
          </p>
          <ul>
            {active.suggestion.critique.map((c) => (
              <li key={c.criterion}>
                {c.criterion}: {c.verdict} — {c.note}
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => decide('accept')} disabled={busy}>
            Accept
          </button>{' '}
          <button type="button" onClick={() => decide('edit')} disabled={busy}>
            Save edit
          </button>{' '}
          <button type="button" onClick={() => decide('reject')} disabled={busy}>
            Reject
          </button>{' '}
          <button type="button" onClick={() => setActive(null)} disabled={busy}>
            Cancel
          </button>
          {history.length > 0 && (
            <details style={{ marginTop: '1rem' }}>
              <summary>Refinement history ({history.length})</summary>
              <ul>
                {history.map((h) => (
                  <li key={h.id}>
                    [{h.action}] {h.before} → {h.after ?? '(rejected — unchanged)'}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      ) : questions.length === 0 ? (
        <p>No clustered questions to refine.</p>
      ) : (
        <ul>
          {questions.map((q) => (
            <li key={q.id} style={{ marginBottom: '1rem' }}>
              <div>{q.canonicalText}</div>
              <button type="button" onClick={() => suggest(q.id)} disabled={busy}>
                Suggest refinement
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
