'use client'

import { useState } from 'react'

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
    <main style={{ maxWidth: 640, margin: '4rem auto', fontFamily: 'system-ui' }}>
      <h1>Submit a question</h1>

      {phase === 'editing' && (
        <form onSubmit={handleSubmit}>
          <textarea
            aria-label="Your question"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            style={{ width: '100%' }}
            required
          />
          <fieldset style={{ marginTop: '0.5rem' }}>
            <legend>Visibility</legend>
            <label>
              <input
                type="radio"
                name="visibility"
                checked={visibility === 'public'}
                onChange={() => setVisibility('public')}
              />{' '}
              Public
            </label>{' '}
            <label>
              <input
                type="radio"
                name="visibility"
                checked={visibility === 'anonymous'}
                onChange={() => setVisibility('anonymous')}
              />{' '}
              Anonymous
            </label>
          </fieldset>
          <button type="submit" disabled={busy || text.trim().length === 0}>
            {busy ? 'Checking…' : 'Submit'}
          </button>
        </form>
      )}

      {phase === 'choosing' && (
        <section>
          <h2>Is your question one of these, or new?</h2>
          <ul>
            {candidates.map((c) => (
              <li key={c.id} style={{ marginBottom: '0.5rem' }}>
                <span>{c.canonicalText}</span>{' '}
                <button type="button" onClick={() => chooseExisting(c.id)} disabled={busy}>
                  This is mine
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={chooseNew} disabled={busy}>
            None of these — mine is new
          </button>
        </section>
      )}

      {phase === 'done' && <p role="status">{message}</p>}
      {phase !== 'done' && message && <p role="alert">{message}</p>}
    </main>
  )
}
