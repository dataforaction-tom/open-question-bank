'use client'

import { useCallback, useEffect, useState } from 'react'
import { PageShell } from '@/components/ui/PageShell'
import { PublicNav } from '@/components/ui/PublicNav'
import { Card } from '@/components/ui/Card'
import { Notice } from '@/components/ui/Notice'
import { Stamp } from '@/components/ui/Stamp'
import { EmptyState } from '@/components/ui/EmptyState'

interface PublicQuestion {
  id: string
  canonicalText: string
  state: 'canonical' | 'ranked'
}

export default function QuestionsIndexPage() {
  const [questions, setQuestions] = useState<PublicQuestion[]>([])
  const [loaded, setLoaded] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/questions')
      if (res.ok) setQuestions((await res.json()).questions)
      else setMessage('Could not load questions.')
    } catch {
      setMessage('Network error — please try again.')
    }
    setLoaded(true)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  return (
    <PageShell nav={<PublicNav />}>
      <div className="space-y-1">
        <p className="eyebrow">The question bank</p>
        <h1 className="text-3xl">Questions</h1>
      </div>
      <p className="text-sm text-muted">Curated questions (canonical and ranked) — showing the most recent.</p>

      {message && (
        <Notice role="alert" tone="error">
          {message}
        </Notice>
      )}

      {!loaded ? (
        <p className="text-muted">Loading…</p>
      ) : message ? null /* error already shown above; don't also show an empty state */ : questions.length === 0 ? (
        <EmptyState>No curated questions yet.</EmptyState>
      ) : (
        <ul className="space-y-3 list-none p-0">
          {questions.map((qn) => (
            <li key={qn.id}>
              <Card className="space-y-1">
                <div className="break-words text-ink">{qn.canonicalText}</div>
                <Stamp>{qn.state}</Stamp>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  )
}
