'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { PageShell } from '@/components/ui/PageShell'
import { PublicNav } from '@/components/ui/PublicNav'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Notice } from '@/components/ui/Notice'
import { Stamp } from '@/components/ui/Stamp'
import { RankingConfidenceChart } from '@/components/charts/RankingConfidenceChart'
import {
  strengthPercent,
  standingLabel,
  confidenceLevel,
  confidenceMeter,
  outcomePhrase,
} from '@/lib/agenda-presentation'

interface Item {
  rank: number
  questionId: string
  canonicalText: string
  mu: number
  sigma: number
  nComparisons: number
}
interface Agenda {
  campaign: { prompt: string; comparisonAxis: string; closesAt: string | null }
  items: Item[]
}
interface Evidence {
  opponentText: string
  outcome: 'won' | 'lost' | 'drew'
  // Note: the API also returns `servedReason` (the internal pairing reason); it is intentionally
  // not surfaced in the public plain-language view, so it is omitted here.
  timestamp: string
}
interface PublicSynthesis {
  synthesisedText: string
  rationale: string
  sources: { questionId: string; canonicalText: string }[]
}

export default function AgendaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [agenda, setAgenda] = useState<Agenda | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [message, setMessage] = useState('')
  const [tone, setTone] = useState<'info' | 'error'>('error')
  const [evidence, setEvidence] = useState<Record<string, Evidence[]>>({})
  const [syntheses, setSyntheses] = useState<PublicSynthesis[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${id}/agenda`)
    const data = await res.json()
    if (res.ok) {
      setAgenda(data)
      const sres = await fetch(`/api/campaigns/${id}/syntheses`)
      if (sres.ok) setSyntheses((await sres.json()).syntheses)
    } else if (res.status === 409) {
      setTone('info')
      setMessage("This campaign's agenda isn't published yet.")
    } else {
      setTone('error')
      setMessage(data.error ?? 'This agenda is not available.')
    }
    setLoaded(true)
  }, [id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  async function toggle(questionId: string) {
    if (openId === questionId) {
      setOpenId(null)
      return
    }
    setOpenId(questionId)
    if (evidence[questionId]) return // cached
    setBusy(true)
    try {
      const res = await fetch(`/api/campaigns/${id}/agenda/${questionId}`)
      if (res.ok) {
        const data = await res.json()
        setEvidence((prev) => ({ ...prev, [questionId]: data.evidence }))
      }
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

  if (!agenda) {
    return (
      <PageShell nav={<PublicNav />}>
        <Notice role={tone === 'error' ? 'alert' : 'status'} tone={tone}>
          {message}
        </Notice>
      </PageShell>
    )
  }

  const closed = agenda.campaign.closesAt ? new Date(agenda.campaign.closesAt).toLocaleDateString() : null
  const maxMu = agenda.items[0]?.mu ?? 0

  return (
    <PageShell nav={<PublicNav />}>
      <div className="space-y-1">
        <p className="eyebrow">{agenda.campaign.comparisonAxis}</p>
        <h1 className="text-3xl">{agenda.campaign.prompt}</h1>
        <Stamp>Final agenda{closed ? ` · closed ${closed}` : ''}</Stamp>
      </div>

      <ul className="space-y-3 list-none p-0">
        {agenda.items.map((item) => {
          const ratio = maxMu > 0 ? item.mu / maxMu : 1
          const pct = strengthPercent(item.mu, maxMu)
          const label = standingLabel(item.rank, ratio)
          const meter = confidenceMeter(confidenceLevel(item.sigma))
          const evidenceRows = evidence[item.questionId]
          return (
            <li key={item.questionId}>
              <Card className="space-y-3">
                <div className="flex gap-3">
                  <span className="font-display text-xl text-moss shrink-0">#{item.rank}</span>
                  <div className="min-w-0 break-words text-ink">{item.canonicalText}</div>
                </div>

                {/* Relative strength bar (decorative — the label carries the meaning). */}
                <div aria-hidden="true" className="h-2 w-full overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full bg-moss" style={{ width: `${pct}%` }} />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-ink">{label}</span>
                  <span title={meter.label} aria-label={meter.label} className="shrink-0 text-sm tracking-widest">
                    {[0, 1, 2].map((i) => (
                      <span key={i} aria-hidden="true" className={i < meter.filled ? 'text-moss' : 'text-line'}>
                        ●
                      </span>
                    ))}
                  </span>
                </div>

                <Button type="button" variant="quiet" onClick={() => toggle(item.questionId)} disabled={busy}>
                  {openId === item.questionId ? 'Hide evidence' : 'Show evidence'}
                </Button>

                {openId === item.questionId &&
                  (evidenceRows ? (
                    evidenceRows.length === 0 ? (
                      <p className="text-sm text-muted">No comparisons recorded.</p>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-sm text-muted">
                          Compared head-to-head {item.nComparisons} {item.nComparisons === 1 ? 'time' : 'times'}.
                        </p>
                        <ul className="space-y-1 list-none p-0">
                          {evidenceRows.map((e, i) => (
                            <li key={i} className="text-sm text-ink">
                              <span className="font-medium">{outcomePhrase(e.outcome)}:</span> &quot;{e.opponentText}&quot;
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  ) : (
                    <p className="text-sm text-muted">
                      {busy ? 'Loading evidence…' : "Couldn’t load evidence — try again."}
                    </p>
                  ))}
              </Card>
            </li>
          )
        })}
      </ul>

      <details className="text-sm">
        <summary className="cursor-pointer text-muted">How was this ranked?</summary>
        <div className="mt-3 space-y-3">
          <p className="text-muted">
            People compared these questions two at a time. Each choice nudges a question up or down;
            the scores and certainty below come from those head-to-head choices.
          </p>
          <RankingConfidenceChart
            items={agenda.items.map((it) => ({
              rank: it.rank,
              canonicalText: it.canonicalText,
              mu: it.mu,
              sigma: it.sigma,
              nComparisons: it.nComparisons,
            }))}
          />
        </div>
      </details>

      {syntheses.length > 0 && (
        <section className="space-y-3">
          <p className="eyebrow">Synthesised questions</p>
          <ul className="space-y-3 list-none p-0">
            {syntheses.map((s, i) => (
              <li key={i}>
                <Card className="space-y-2">
                  <p className="text-ink">{s.synthesisedText}</p>
                  <p className="text-sm text-muted">{s.rationale}</p>
                  <Stamp>Synthesised from:</Stamp>
                  <ul className="space-y-1 list-none p-0">
                    {s.sources.map((src) => (
                      <li key={src.questionId} className="text-sm text-ink break-words">
                        — {src.canonicalText}
                      </li>
                    ))}
                  </ul>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  )
}
