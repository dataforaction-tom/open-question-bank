'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { PageShell } from '@/components/ui/PageShell'
import { PublicNav } from '@/components/ui/PublicNav'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Notice } from '@/components/ui/Notice'
import { Stamp } from '@/components/ui/Stamp'

interface Pair {
  a: { id: string; canonicalText: string }
  b: { id: string; canonicalText: string }
  servedReason: string
}
interface Info {
  prompt: string
  comparisonAxis: string
}

export default function JudgePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [info, setInfo] = useState<Info | null>(null)
  const [pair, setPair] = useState<Pair | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const loadPair = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${id}/pair`)
    const data = await res.json()
    if (res.ok) {
      setInfo(data.campaign)
      setPair(data.pair)
    } else {
      setMessage(data.error ?? 'This campaign is not available.')
    }
    setLoaded(true)
  }, [id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPair()
  }, [loadPair])

  async function judge(winnerQuestionId: string | null) {
    if (!pair) return
    setBusy(true)
    setMessage('')
    try {
      const res = await fetch(`/api/campaigns/${id}/comparisons`, {
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
        setMessage((await res.json()).error ?? 'Could not record your choice.')
        return
      }
      const nx = await fetch(`/api/campaigns/${id}/pair`)
      const data = await nx.json()
      if (nx.ok) {
        setInfo(data.campaign)
        setPair(data.pair)
      } else {
        setMessage(data.error ?? 'This campaign is not available.')
      }
    } catch {
      setMessage('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) {
    return (
      <PageShell nav={<PublicNav />}>
        <p className="text-muted">Loading…</p>
      </PageShell>
    )
  }

  return (
    <PageShell nav={<PublicNav />}>
      {/* Every message routed here is a problem (network/record failure, or the
          campaign being unavailable) — use the alert tone so assistive tech
          announces it. The positive end-state is a separate <p> below. */}
      {message && (
        <Notice role="alert" tone="error">
          {message}
        </Notice>
      )}

      {info && (
        <div className="space-y-1">
          <p className="eyebrow">{info.comparisonAxis}</p>
          <h1 className="text-3xl">{info.prompt}</h1>
        </div>
      )}

      {pair ? (
        <Card className="space-y-3">
          <p className="text-ink">Which is more {info?.comparisonAxis}?</p>
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
      ) : (
        !message && (
          <p className="text-muted">No more pairs for you right now — thank you for judging.</p>
        )
      )}
    </PageShell>
  )
}
