'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { PageShell } from '@/components/ui/PageShell'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Notice } from '@/components/ui/Notice'
import { Stamp } from '@/components/ui/Stamp'

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
  servedReason: string | null
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
      <PageShell>
        <p className="text-muted">Loading…</p>
      </PageShell>
    )
  }

  if (!agenda) {
    return (
      <PageShell>
        <Notice role={tone === 'error' ? 'alert' : 'status'} tone={tone}>
          {message}
        </Notice>
      </PageShell>
    )
  }

  const closed = agenda.campaign.closesAt ? new Date(agenda.campaign.closesAt).toLocaleDateString() : null

  return (
    <PageShell>
      <div className="space-y-1">
        <p className="eyebrow">{agenda.campaign.comparisonAxis}</p>
        <h1 className="text-3xl">{agenda.campaign.prompt}</h1>
        <Stamp>Final agenda{closed ? ` · closed ${closed}` : ''}</Stamp>
      </div>

      <ul className="space-y-3 list-none p-0">
        {agenda.items.map((item) => (
          <li key={item.questionId}>
            <Card className="space-y-2">
              <div className="flex gap-3">
                <span className="font-display text-xl text-moss shrink-0">#{item.rank}</span>
                <div className="min-w-0 break-words text-ink">{item.canonicalText}</div>
              </div>
              <Stamp>
                μ {item.mu.toFixed(1)} · σ {item.sigma.toFixed(1)} · {item.nComparisons} comparisons
              </Stamp>
              <Button
                type="button"
                variant="quiet"
                onClick={() => toggle(item.questionId)}
                disabled={busy}
              >
                {openId === item.questionId ? 'Hide evidence' : 'Show evidence'}
              </Button>
              {openId === item.questionId &&
                (evidence[item.questionId] ? (
                  <ul className="space-y-1 list-none p-0">
                    {evidence[item.questionId].length === 0 ? (
                      <li className="text-sm text-muted">No comparisons recorded.</li>
                    ) : (
                      evidence[item.questionId].map((e, i) => (
                        <li key={i} className="text-sm text-ink">
                          <span className="font-medium">{e.outcome}</span> vs &quot;{e.opponentText}&quot;
                          {e.servedReason && <Stamp>{e.servedReason}</Stamp>}
                        </li>
                      ))
                    )}
                  </ul>
                ) : (
                  // Open but no cached evidence: either still loading, or the fetch
                  // failed — say so rather than leaving a blank, confusing panel.
                  <p className="text-sm text-muted">
                    {busy ? 'Loading evidence…' : 'Couldn’t load evidence — try again.'}
                  </p>
                ))}
            </Card>
          </li>
        ))}
      </ul>

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
