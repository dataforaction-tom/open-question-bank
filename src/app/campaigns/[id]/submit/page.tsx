'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { PageShell } from '@/components/ui/PageShell'
import { PublicNav } from '@/components/ui/PublicNav'
import { Notice } from '@/components/ui/Notice'
import { Stamp } from '@/components/ui/Stamp'
import { SubmitForm } from '@/components/SubmitForm'

interface CampaignInfo {
  id: string
  prompt: string
  comparisonAxis: string
  state: 'open' | 'comparing' | 'closed'
}

export default function CampaignSubmitPage() {
  const { id } = useParams<{ id: string }>()
  const [campaign, setCampaign] = useState<CampaignInfo | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns/${id}`)
      if (res.ok) setCampaign(await res.json())
      else if (res.status === 404) setMessage('That campaign does not exist.')
      else setMessage('Could not load this campaign.')
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
        <Link href="/campaigns" className="no-underline hover:underline">
          ← All campaigns
        </Link>
      </p>

      {message && (
        <Notice role="alert" tone="error">
          {message}
        </Notice>
      )}

      {!message && !loaded && <p className="text-muted">Loading…</p>}

      {campaign && (
        <>
          <div className="space-y-2">
            <p className="eyebrow">Submit into this campaign</p>
            <h1 className="text-2xl sm:text-3xl break-words">{campaign.prompt}</h1>
            <Stamp>Comparison axis: {campaign.comparisonAxis}</Stamp>
          </div>

          {campaign.state === 'open' ? (
            <SubmitForm campaignId={campaign.id} />
          ) : (
            <Notice role="status" tone="info">
              This campaign isn’t accepting submissions right now.{' '}
              {campaign.state === 'comparing' ? (
                <>
                  It’s open for judging — <Link href={`/judge/${campaign.id}`}>help judge it</Link>.
                </>
              ) : (
                <>
                  Its agenda is published — <Link href={`/campaigns/${campaign.id}`}>view it</Link>.
                </>
              )}
            </Notice>
          )}
        </>
      )}
    </PageShell>
  )
}
