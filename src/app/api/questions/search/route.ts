import { NextResponse } from 'next/server'
import {
  searchQuestions,
  PUBLIC_SEARCH_STATES,
  type DefinednessBand,
  type SearchFilters,
} from '@/lib/search'
import { mapPublicError } from '@/lib/api-errors'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BANDS = new Set(['low', 'medium', 'high'])

/**
 * Public keyword search over the curated question bank. Anonymised and restricted to published
 * states (canonical/ranked); never exposes submitter identity, embeddings, or in-flight states.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const query = params.get('q') ?? ''
  const page = Number(params.get('page') ?? '0')
  const pageSize = Number(params.get('pageSize') ?? '20')

  const filters: SearchFilters = { states: PUBLIC_SEARCH_STATES }

  const cluster = params.get('cluster')
  if (cluster) {
    if (!UUID_RE.test(cluster)) return NextResponse.json({ error: 'Invalid cluster' }, { status: 400 })
    filters.clusterId = cluster
  }
  const campaign = params.get('campaign')
  if (campaign) {
    if (!UUID_RE.test(campaign)) return NextResponse.json({ error: 'Invalid campaign' }, { status: 400 })
    filters.campaignId = campaign
  }
  const band = params.get('definedness')
  if (band) {
    if (!BANDS.has(band)) return NextResponse.json({ error: 'Invalid definedness band' }, { status: 400 })
    filters.definednessBand = band as DefinednessBand
  }

  try {
    const result = await searchQuestions({
      query,
      filters,
      page: Number.isFinite(page) ? page : 0,
      pageSize: Number.isFinite(pageSize) ? pageSize : 20,
    })
    return NextResponse.json(result)
  } catch (err) {
    return mapPublicError(err, '[GET /api/questions/search]')
  }
}
