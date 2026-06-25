'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { PageShell } from '@/components/ui/PageShell'
import { PublicNav } from '@/components/ui/PublicNav'
import { buttonClasses } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Notice } from '@/components/ui/Notice'
import { Stamp } from '@/components/ui/Stamp'
import { EmptyState } from '@/components/ui/EmptyState'

interface PublicCampaign {
  id: string
  prompt: string
  comparisonAxis: string
  closesAt: string | null
  questionCount: number
}

export default function CampaignsIndexPage() {
  const [published, setPublished] = useState<PublicCampaign[]>([])
  const [openForJudging, setOpenForJudging] = useState<PublicCampaign[]>([])
  const [openForSubmission, setOpenForSubmission] = useState<PublicCampaign[]>([])
  const [loaded, setLoaded] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/campaigns')
      if (res.ok) {
        const data = await res.json()
        setPublished(data.published)
        setOpenForJudging(data.openForJudging)
        setOpenForSubmission(data.openForSubmission ?? [])
      } else {
        setMessage('Could not load campaigns.')
      }
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
        <p className="eyebrow">Discover</p>
        <h1 className="text-3xl">Campaigns</h1>
      </div>

      {message && (
        <Notice role="alert" tone="error">
          {message}
        </Notice>
      )}

      {/* Hide the lists on error so the failure isn't mistaken for an empty index. */}
      {!message && (
        <>
          <section className="space-y-3">
            <p className="eyebrow">Open for submission</p>
            {!loaded ? (
              <p className="text-muted">Loading…</p>
            ) : openForSubmission.length === 0 ? (
              <EmptyState>No campaigns are accepting submissions right now.</EmptyState>
            ) : (
              <ul className="space-y-3 list-none p-0">
                {openForSubmission.map((c) => (
                  <li key={c.id}>
                    <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="break-words text-ink">{c.prompt}</div>
                        <Stamp>{c.comparisonAxis}</Stamp>
                      </div>
                      <Link
                        href={`/campaigns/${c.id}/submit`}
                        className={buttonClasses('accent', 'shrink-0 self-start sm:self-auto')}
                      >
                        Submit a question →
                      </Link>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <p className="eyebrow">Published agendas</p>
        {!loaded ? (
          <p className="text-muted">Loading…</p>
        ) : published.length === 0 ? (
          <EmptyState>No published agendas yet.</EmptyState>
        ) : (
          <ul className="space-y-3 list-none p-0">
            {published.map((c) => (
              <li key={c.id}>
                <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="break-words text-ink">{c.prompt}</div>
                    <Stamp>
                      {c.comparisonAxis} · {c.questionCount} questions
                      {c.closesAt ? ` · closed ${new Date(c.closesAt).toLocaleDateString()}` : ''}
                    </Stamp>
                  </div>
                  <Link
                    href={`/campaigns/${c.id}`}
                    className={buttonClasses('ghost', 'shrink-0 self-start sm:self-auto')}
                  >
                    View agenda
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <p className="eyebrow">Open for judging</p>
        {!loaded ? (
          <p className="text-muted">Loading…</p>
        ) : openForJudging.length === 0 ? (
          <EmptyState>Nothing open for judging right now.</EmptyState>
        ) : (
          <ul className="space-y-3 list-none p-0">
            {openForJudging.map((c) => (
              <li key={c.id}>
                <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="break-words text-ink">{c.prompt}</div>
                    <Stamp>
                      {c.comparisonAxis} · {c.questionCount} questions
                    </Stamp>
                  </div>
                  <Link
                    href={`/judge/${c.id}`}
                    className={buttonClasses('accent', 'shrink-0 self-start sm:self-auto')}
                  >
                    Help judge →
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
        </>
      )}
    </PageShell>
  )
}
