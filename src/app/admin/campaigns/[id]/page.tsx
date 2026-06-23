'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { AdminShell } from '@/components/ui/AdminShell'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Notice } from '@/components/ui/Notice'
import { Stamp } from '@/components/ui/Stamp'
import { SynthesisPanel } from '@/components/ui/SynthesisPanel'

interface Member {
  id: string
  canonicalText: string
}
interface ScoreRow {
  questionId: string
  mu: number
  sigma: number
  nComparisons: number
}
interface CampaignDetail {
  campaign: { id: string; prompt: string; comparisonAxis: string; state: string }
  members: Member[]
  scores: ScoreRow[]
}
interface Pair {
  a: Member
  b: Member
  servedReason: string
}
interface Candidate {
  id: string
  canonicalText: string
}

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [detail, setDetail] = useState<CampaignDetail | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [pair, setPair] = useState<Pair | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/campaigns/${id}`)
    if (res.ok) setDetail(await res.json())
    else setMessage('Could not load this campaign.')
  }, [id])

  const loadCandidates = useCallback(async () => {
    const res = await fetch('/api/admin/questions?state=canonical')
    if (res.ok) setCandidates((await res.json()).questions)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    loadCandidates()
  }, [load, loadCandidates])

  const state = detail?.campaign.state
  const memberIds = new Set(detail?.members.map((m) => m.id))
  const addable = candidates.filter((c) => !memberIds.has(c.id))
  const textById = new Map(detail?.members.map((m) => [m.id, m.canonicalText]))

  // Fetch the next pair into state. Does NOT manage `busy`/errors — the caller
  // owns that, so judge() can reuse it without an early `busy` release.
  async function refreshPair() {
    const res = await fetch(`/api/admin/campaigns/${id}/pair`)
    const data = await res.json()
    if (res.ok) {
      setPair(data.pair)
      setMessage(data.pair ? '' : 'No more informative pairs — comparison has settled.')
    } else {
      setMessage(data.error ?? 'Error')
    }
  }

  async function add(questionId: string) {
    setBusy(true)
    setMessage('')
    try {
      const res = await fetch(`/api/admin/campaigns/${id}/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIds: [questionId] }),
      })
      if (!res.ok) {
        setMessage((await res.json()).error ?? 'Could not add the question.')
        return
      }
      await load()
    } catch {
      setMessage('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function transition(path: 'open' | 'close') {
    setBusy(true)
    setMessage('')
    try {
      const res = await fetch(`/api/admin/campaigns/${id}/${path}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) setMessage(data.error ?? 'Error')
      setPair(null)
      await load()
    } catch {
      setMessage('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function getPair() {
    setBusy(true)
    setMessage('')
    try {
      await refreshPair()
    } catch {
      setMessage('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function judge(winnerQuestionId: string | null) {
    if (!pair) return
    setBusy(true)
    setMessage('')
    try {
      const res = await fetch(`/api/admin/campaigns/${id}/comparisons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionAId: pair.a.id,
          questionBId: pair.b.id,
          winnerQuestionId,
          servedReason: pair.servedReason,
        }),
      })
      if (!res.ok) {
        setMessage((await res.json()).error ?? 'Could not record the comparison.')
        return
      }
      await load()
      await refreshPair()
    } catch {
      setMessage('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!detail) {
    return (
      <AdminShell>
        {message ? (
          <Notice role="alert" tone="error">
            {message}
          </Notice>
        ) : (
          <p className="text-muted">Loading…</p>
        )}
      </AdminShell>
    )
  }

  return (
    <AdminShell>
      <div className="space-y-1">
        <p className="eyebrow">{detail.campaign.comparisonAxis} · {detail.campaign.state}</p>
        <h1 className="text-3xl">{detail.campaign.prompt}</h1>
      </div>

      {message && (
        <Notice role="status" tone="info">
          {message}
        </Notice>
      )}

      <div className="flex flex-wrap gap-2">
        {state === 'draft' && (
          <Button type="button" onClick={() => transition('open')} disabled={busy}>
            Open for comparison
          </Button>
        )}
        {state === 'comparing' && (
          <>
            <Button type="button" onClick={getPair} disabled={busy}>
              Get next pair
            </Button>
            <Button type="button" variant="quiet" onClick={() => transition('close')} disabled={busy}>
              Close campaign
            </Button>
          </>
        )}
      </div>

      {state === 'comparing' && (
        <Stamp>Public judging link: /judge/{detail.campaign.id}</Stamp>
      )}

      {state === 'closed' && (
        <Stamp>Public agenda: /campaigns/{detail.campaign.id}</Stamp>
      )}

      {state === 'closed' && <SynthesisPanel campaignId={detail.campaign.id} />}

      {state === 'comparing' && pair && (
        <Card className="space-y-3">
          <Stamp>{pair.servedReason}</Stamp>
          <div className="grid gap-3 sm:grid-cols-2">
            <Button type="button" variant="ghost" onClick={() => judge(pair.a.id)} disabled={busy}>
              {pair.a.canonicalText}
            </Button>
            <Button type="button" variant="ghost" onClick={() => judge(pair.b.id)} disabled={busy}>
              {pair.b.canonicalText}
            </Button>
          </div>
          <Button type="button" variant="quiet" onClick={() => judge(null)} disabled={busy}>
            Can&rsquo;t decide
          </Button>
        </Card>
      )}

      <section className="space-y-2">
        <p className="eyebrow">Ranking</p>
        {detail.scores.length === 0 ? (
          <p className="text-muted">No scores yet.</p>
        ) : (
          <ul className="space-y-2 list-none p-0">
            {detail.scores.map((s) => (
              <li key={s.questionId} className="text-sm text-ink">
                <span className="font-medium">μ {s.mu.toFixed(1)}</span>{' '}
                <span className="text-muted">σ {s.sigma.toFixed(1)} · {s.nComparisons} comparisons</span>
                <div className="break-words">{textById.get(s.questionId) ?? s.questionId}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {state === 'draft' && (
        <section className="space-y-2">
          <p className="eyebrow">Add canonical questions</p>
          {addable.length === 0 ? (
            <p className="text-muted">No more canonical questions to add.</p>
          ) : (
            <ul className="space-y-2 list-none p-0">
              {addable.map((c) => (
                <li key={c.id}>
                  <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 break-words text-ink">{c.canonicalText}</div>
                    <Button
                      type="button"
                      className="shrink-0 self-start sm:self-auto"
                      onClick={() => add(c.id)}
                      disabled={busy}
                    >
                      Add
                    </Button>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </AdminShell>
  )
}
