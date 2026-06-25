'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { PageShell } from '@/components/ui/PageShell'
import { PublicNav } from '@/components/ui/PublicNav'
import { Card } from '@/components/ui/Card'
import { Notice } from '@/components/ui/Notice'
import { Stamp } from '@/components/ui/Stamp'
import { EmptyState } from '@/components/ui/EmptyState'

interface QuestionDetail {
  id: string
  canonicalText: string
  state: 'canonical' | 'ranked'
  cluster: { id: string; representativeText: string | null; size: number } | null
  campaigns: { id: string; prompt: string; state: 'comparing' | 'closed' }[]
  refinement: { count: number; criteria: string[] }
}
interface Similar {
  id: string
  canonicalText: string
  state: 'canonical' | 'ranked'
  distance: number
}

export default function QuestionDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const [detail, setDetail] = useState<QuestionDetail | null>(null)
  const [similar, setSimilar] = useState<Similar[]>([])
  const [loaded, setLoaded] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    try {
      const [detailRes, similarRes] = await Promise.all([
        fetch(`/api/questions/${id}`),
        fetch(`/api/questions/${id}/similar`),
      ])
      if (detailRes.ok) {
        setDetail(await detailRes.json())
      } else if (detailRes.status === 404) {
        setMessage('That question is not published, or does not exist.')
      } else {
        setMessage('Could not load this question.')
      }
      if (similarRes.ok) setSimilar((await similarRes.json()).similar)
    } catch {
      setMessage('Network error — please try again.')
    }
    setLoaded(true)
  }, [id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  return (
    <PageShell nav={<PublicNav />}>
      <p className="eyebrow">
        <Link href="/browse" className="no-underline hover:underline">
          ← Back to search
        </Link>
      </p>

      {message && (
        <Notice role="alert" tone="error">
          {message}
        </Notice>
      )}

      {!message && !loaded && <p className="text-muted">Loading…</p>}

      {detail && (
        <>
          <div className="space-y-2">
            <h1 className="text-2xl break-words">{detail.canonicalText}</h1>
            <Stamp>{detail.state}</Stamp>
          </div>

          {detail.cluster && (
            <Card className="space-y-1">
              <p className="eyebrow">Cluster</p>
              <p className="text-ink break-words">
                {detail.cluster.representativeText ?? 'Grouped with related questions'}
              </p>
              <Stamp>{detail.cluster.size} question{detail.cluster.size === 1 ? '' : 's'} in this cluster</Stamp>
            </Card>
          )}

          <section className="space-y-2">
            <p className="eyebrow">Campaigns</p>
            {detail.campaigns.length === 0 ? (
              <p className="text-sm text-muted">Not part of any public campaign yet.</p>
            ) : (
              <ul className="space-y-2 list-none p-0">
                {detail.campaigns.map((c) => (
                  <li key={c.id}>
                    <Card className="flex items-center justify-between gap-3">
                      <span className="min-w-0 break-words text-ink">{c.prompt}</span>
                      <Link
                        href={c.state === 'closed' ? `/campaigns/${c.id}` : `/judge/${c.id}`}
                        className="shrink-0 text-moss no-underline hover:underline"
                      >
                        {c.state === 'closed' ? 'View agenda →' : 'Help judge →'}
                      </Link>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <p className="eyebrow">Refinement lineage</p>
            {detail.refinement.count === 0 ? (
              <p className="text-sm text-muted">No refinements recorded.</p>
            ) : (
              <p className="text-sm text-muted">
                {detail.refinement.count} refinement{detail.refinement.count === 1 ? '' : 's'} recorded
                {detail.refinement.criteria.length > 0
                  ? `, against: ${detail.refinement.criteria.join(', ')}.`
                  : '.'}
              </p>
            )}
          </section>

          <section className="space-y-2" id="similar">
            <p className="eyebrow">Similar questions</p>
            {similar.length === 0 ? (
              <EmptyState>No similar questions found.</EmptyState>
            ) : (
              <ul className="space-y-2 list-none p-0">
                {similar.map((s) => (
                  <li key={s.id}>
                    <Card>
                      <Link href={`/questions/${s.id}`} className="break-words text-ink no-underline hover:underline">
                        {s.canonicalText}
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
