'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { PageShell } from '@/components/ui/PageShell'
import { PublicNav } from '@/components/ui/PublicNav'
import { Button, buttonClasses } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Notice } from '@/components/ui/Notice'
import { Stamp } from '@/components/ui/Stamp'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input, Label } from '@/components/ui/Field'

interface Result {
  id: string
  canonicalText: string
  state: 'canonical' | 'ranked'
  rank: number
}
interface Similar {
  id: string
  canonicalText: string
  state: 'canonical' | 'ranked'
  distance: number
}
interface SimilarState {
  open: boolean
  loading: boolean
  items: Similar[]
  error?: string
}

const BANDS = [
  { value: '', label: 'Any definedness' },
  { value: 'high', label: 'High definedness' },
  { value: 'medium', label: 'Medium definedness' },
  { value: 'low', label: 'Low definedness' },
]

export default function BrowsePage() {
  const [queryInput, setQueryInput] = useState('')
  const [band, setBand] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [searched, setSearched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [similar, setSimilar] = useState<Record<string, SimilarState>>({})

  const runSearch = useCallback(async (query: string, nextPage: number, bandValue: string) => {
    setLoading(true)
    setMessage('')
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
      } else {
        setMessage('Could not run that search.')
      }
    } catch {
      setMessage('Network error — please try again.')
    }
    setSearched(true)
    setLoading(false)
  }, [])

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (queryInput.trim().length === 0) return
    runSearch(queryInput.trim(), 0, band)
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
        <h1 className="text-3xl">Search the question bank</h1>
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <Label htmlFor="q">Search</Label>
          <Input
            id="q"
            name="q"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="e.g. community resilience"
            autoComplete="off"
          />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="definedness">Filter</Label>
            <select
              id="definedness"
              value={band}
              onChange={(e) => setBand(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink hover:border-sage transition-colors min-h-11"
            >
              {BANDS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={loading || queryInput.trim().length === 0}>
            {loading ? 'Searching…' : 'Search'}
          </Button>
        </div>
      </form>

      {message && (
        <Notice role="alert" tone="error">
          {message}
        </Notice>
      )}

      {!message && searched && (
        <section className="space-y-3" aria-live="polite">
          {results.length === 0 ? (
            <EmptyState>No questions matched that search.</EmptyState>
          ) : (
            <ul className="space-y-3 list-none p-0">
              {results.map((r) => {
                const sim = similar[r.id]
                return (
                  <li key={r.id}>
                    <Card className="space-y-2">
                      <Link href={`/questions/${r.id}`} className="break-words text-ink no-underline hover:underline">
                        {r.canonicalText}
                      </Link>
                      <div className="flex items-center justify-between gap-3">
                        <Stamp>{r.state}</Stamp>
                        <button
                          type="button"
                          onClick={() => toggleSimilar(r.id)}
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
                                  <Link href={`/questions/${s.id}`} className="text-moss">
                                    {s.canonicalText}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </Card>
                  </li>
                )
              })}
            </ul>
          )}

          {(page > 0 || hasMore) && results.length > 0 && (
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                disabled={page === 0 || loading}
                onClick={() => runSearch(queryInput.trim(), page - 1, band)}
              >
                ← Previous
              </Button>
              <span className="text-sm text-muted">Page {page + 1}</span>
              <Button
                variant="ghost"
                disabled={!hasMore || loading}
                onClick={() => runSearch(queryInput.trim(), page + 1, band)}
              >
                Next →
              </Button>
            </div>
          )}
        </section>
      )}
    </PageShell>
  )
}
