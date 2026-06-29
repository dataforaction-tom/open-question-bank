'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { PageShell } from '@/components/ui/PageShell'
import { PublicNav } from '@/components/ui/PublicNav'
import { Button, buttonClasses } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Notice } from '@/components/ui/Notice'
import { Stamp } from '@/components/ui/Stamp'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input, Label } from '@/components/ui/Field'
import { QuestionGraph } from '@/components/charts/QuestionGraph'

interface Result { id: string; canonicalText: string; state: 'canonical' | 'ranked'; rank?: number }
interface Similar { id: string; canonicalText: string; state: 'canonical' | 'ranked'; distance: number }
interface SimilarState { open: boolean; loading: boolean; items: Similar[]; error?: string }
interface TopCampaign extends Result { campaignId: string; campaignPrompt: string; comparisonAxis: string; closesAt: string }
interface MostAsked extends Result { clusterSize: number }
interface ThemeCount { theme: string; count: number }
interface Rails { recent: Result[]; topOfCampaigns: TopCampaign[]; mostAsked: MostAsked[]; themes: ThemeCount[] }
interface GraphNode { id: string; canonicalText: string; state: string; theme: string | null; clusterId: string | null; variantCount: number }
interface GraphEdge { source: string; target: string; clusterId: string }
interface GraphData { nodes: GraphNode[]; edges: GraphEdge[] }

const BANDS = [
  { value: '', label: 'Any definedness' },
  { value: 'high', label: 'High definedness' },
  { value: 'medium', label: 'Medium definedness' },
  { value: 'low', label: 'Low definedness' },
]

function Rail({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl">{title}</h2>
      {children}
    </section>
  )
}

function QuestionCard({
  r,
  sim,
  onToggleSimilar,
}: {
  r: Result
  sim: SimilarState | undefined
  onToggleSimilar: (id: string) => void
}) {
  return (
    <Card className="space-y-2">
      <Link href={`/questions/${r.id}`} className="break-words text-ink no-underline hover:underline">
        {r.canonicalText}
      </Link>
      <div className="flex items-center justify-between gap-3">
        <Stamp>{r.state}</Stamp>
        <button
          type="button"
          onClick={() => onToggleSimilar(r.id)}
          aria-expanded={sim?.open ?? false}
          className={buttonClasses('quiet', 'shrink-0')}
        >
          {sim?.open ? 'Hide similar' : 'Find similar'}
        </button>
      </div>
      {sim?.open && (
        <div className="border-t border-line pt-2">
          {sim.loading ? (
            <p className="text-sm text-muted">Finding similar…</p>
          ) : sim.error ? (
            <p className="text-sm text-clay">{sim.error}</p>
          ) : sim.items.length === 0 ? (
            <p className="text-sm text-muted">No similar questions found.</p>
          ) : (
            <ul className="space-y-1 list-none p-0">
              {sim.items.map((s) => (
                <li key={s.id} className="text-sm">
                  <Link href={`/questions/${s.id}`} className="text-moss">{s.canonicalText}</Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}

export default function BrowsePage() {
  const [mode, setMode] = useState<'browse' | 'results'>('browse')
  const [rails, setRails] = useState<Rails | null>(null)
  const [railsError, setRailsError] = useState('')

  const [queryInput, setQueryInput] = useState('')
  const [band, setBand] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [resultsTitle, setResultsTitle] = useState('')
  const [similar, setSimilar] = useState<Record<string, SimilarState>>({})
  const [graph, setGraph] = useState<GraphData | null>(null)

  const loadRails = useCallback(async () => {
    try {
      const [railsRes, graphRes] = await Promise.all([
        fetch('/api/browse'),
        fetch('/api/browse/graph'),
      ])
      if (railsRes.ok) setRails(await railsRes.json())
      else setRailsError('Could not load the question bank.')
      if (graphRes.ok) setGraph(await graphRes.json())
    } catch {
      setRailsError('Network error — please try again.')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRails()
  }, [loadRails])

  const runSearch = useCallback(async (query: string, nextPage: number, bandValue: string) => {
    setLoading(true)
    setMessage('')
    setMode('results')
    setResultsTitle(`Results for "${query}"`)
    try {
      const params = new URLSearchParams({ q: query, page: String(nextPage) })
      if (bandValue) params.set('definedness', bandValue)
      const res = await fetch(`/api/questions/search?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setResults(data.results)
        setHasMore(data.hasMore)
        setPage(data.page)
        setSimilar({})
      } else setMessage('Could not run that search.')
    } catch {
      setMessage('Network error — please try again.')
    }
    setLoading(false)
  }, [])

  const openTheme = useCallback(async (theme: string) => {
    setLoading(true)
    setMessage('')
    setMode('results')
    setResultsTitle(theme)
    setHasMore(false)
    setPage(0)
    try {
      const res = await fetch(`/api/questions?theme=${encodeURIComponent(theme)}`)
      if (res.ok) {
        setResults((await res.json()).questions)
        setSimilar({})
      } else setMessage('Could not load that theme.')
    } catch {
      setMessage('Network error — please try again.')
    }
    setLoading(false)
  }, [])

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (queryInput.trim().length === 0) return
    runSearch(queryInput.trim(), 0, band)
  }

  const backToBrowse = () => {
    setMode('browse')
    setResults([])
    setMessage('')
    setQueryInput('')
  }

  const toggleSimilar = useCallback(async (id: string) => {
    const current = similar[id]
    if (current?.open) {
      setSimilar((prev) => ({ ...prev, [id]: { ...prev[id], open: false } }))
      return
    }
    if (current && !current.error) {
      setSimilar((prev) => ({ ...prev, [id]: { ...prev[id], open: true } }))
      return
    }
    setSimilar((prev) => ({ ...prev, [id]: { open: true, loading: true, items: [] } }))
    try {
      const res = await fetch(`/api/questions/${id}/similar`)
      if (res.ok) {
        const data = await res.json()
        setSimilar((prev) => ({ ...prev, [id]: { open: true, loading: false, items: data.similar } }))
      } else {
        setSimilar((prev) => ({ ...prev, [id]: { open: true, loading: false, items: [], error: 'Could not load similar questions.' } }))
      }
    } catch {
      setSimilar((prev) => ({ ...prev, [id]: { open: true, loading: false, items: [], error: 'Network error.' } }))
    }
  }, [similar])

  return (
    <PageShell nav={<PublicNav />} size="lg">
      <div className="space-y-1">
        <p className="eyebrow">Explore</p>
        <h1 className="text-3xl">Browse the question bank</h1>
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <Label htmlFor="q">Search</Label>
          <Input id="q" name="q" value={queryInput} onChange={(e) => setQueryInput(e.target.value)} placeholder="e.g. community resilience" autoComplete="off" />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="definedness">Filter</Label>
            <select id="definedness" value={band} onChange={(e) => setBand(e.target.value)} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink hover:border-sage transition-colors min-h-11">
              {BANDS.map((b) => (<option key={b.value} value={b.value}>{b.label}</option>))}
            </select>
          </div>
          <Button type="submit" disabled={loading || queryInput.trim().length === 0}>{loading ? 'Searching…' : 'Search'}</Button>
        </div>
      </form>

      {mode === 'results' ? (
        <section className="space-y-3" aria-live="polite">
          <div className="flex items-center justify-between">
            <h2 className="text-xl">{resultsTitle}</h2>
            <Button variant="ghost" onClick={backToBrowse}>← Back to browse</Button>
          </div>
          {message ? (
            <Notice role="alert" tone="error">{message}</Notice>
          ) : results.length === 0 ? (
            <EmptyState>No questions matched.</EmptyState>
          ) : (
            <ul className="space-y-3 list-none p-0">
              {results.map((r) => (
                <li key={r.id}>
                  <QuestionCard r={r} sim={similar[r.id]} onToggleSimilar={toggleSimilar} />
                </li>
              ))}
            </ul>
          )}
          {(page > 0 || hasMore) && results.length > 0 && (
            <div className="flex items-center justify-between">
              <Button variant="ghost" disabled={page === 0 || loading} onClick={() => runSearch(queryInput.trim(), page - 1, band)}>← Previous</Button>
              <span className="text-sm text-muted">Page {page + 1}</span>
              <Button variant="ghost" disabled={!hasMore || loading} onClick={() => runSearch(queryInput.trim(), page + 1, band)}>Next →</Button>
            </div>
          )}
        </section>
      ) : railsError ? (
        <Notice role="alert" tone="error">{railsError}</Notice>
      ) : !rails ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <div className="space-y-8">
          <Rail title="By theme">
            <div className="flex flex-wrap gap-2">
              {rails.themes.filter((t) => t.count > 0).map((t) => (
                <button key={t.theme} type="button" onClick={() => openTheme(t.theme)} className={buttonClasses('quiet')}>
                  {t.theme} ({t.count})
                </button>
              ))}
            </div>
          </Rail>

          <Rail title="Most recent">
            {rails.recent.length === 0 ? <EmptyState>No questions yet.</EmptyState> : (
              <ul className="space-y-3 list-none p-0">
                {rails.recent.map((r) => (
                  <li key={r.id}>
                    <QuestionCard r={r} sim={similar[r.id]} onToggleSimilar={toggleSimilar} />
                  </li>
                ))}
              </ul>
            )}
          </Rail>

          <Rail title="Top of recent campaigns">
            {rails.topOfCampaigns.length === 0 ? <EmptyState>No published campaigns yet.</EmptyState> : (
              <ul className="space-y-3 list-none p-0">
                {rails.topOfCampaigns.map((r) => (
                  <li key={`${r.campaignId}-${r.id}`}>
                    <Card className="space-y-1">
                      <Link href={`/questions/${r.id}`} className="break-words text-ink no-underline hover:underline">{r.canonicalText}</Link>
                      <p className="text-sm text-muted">
                        <Link href={`/campaigns/${r.campaignId}`} className="text-moss no-underline hover:underline">{r.campaignPrompt}</Link>
                        {' · '}{r.comparisonAxis}{' · closed '}{new Date(r.closesAt).toLocaleDateString()}
                      </p>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </Rail>

          <Rail title="Most asked about">
            {rails.mostAsked.length === 0 ? <EmptyState>No clusters yet.</EmptyState> : (
              <ul className="space-y-3 list-none p-0">
                {rails.mostAsked.map((r) => (
                  <li key={r.id}>
                    <Card className="space-y-1">
                      <Link href={`/questions/${r.id}`} className="break-words text-ink no-underline hover:underline">{r.canonicalText}</Link>
                      <Stamp>asked by {r.clusterSize}</Stamp>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </Rail>

          {graph && graph.nodes.length > 0 && (
            <Rail title="Question map">
              <QuestionGraph nodes={graph.nodes} edges={graph.edges} />
            </Rail>
          )}
        </div>
      )}
    </PageShell>
  )
}
