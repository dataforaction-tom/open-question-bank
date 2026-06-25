import { NextResponse } from 'next/server'
import {
  searchQuestions,
  ALL_QUESTION_STATES,
  type DefinednessBand,
  type QuestionState,
  type SearchFilters,
} from '@/lib/search'
import { mapError } from '@/lib/api-errors'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BANDS = new Set(['low', 'medium', 'high'])
const VALID_STATES = new Set<string>(ALL_QUESTION_STATES)

/**
 * Admin keyword search — spans the whole question lifecycle. Guarded by the /api/admin
 * middleware. Optional comma-separated `state` filter; defaults to all states.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const query = params.get('q') ?? ''
  const page = Number(params.get('page') ?? '0')
  const pageSize = Number(params.get('pageSize') ?? '20')

  let states: QuestionState[] = ALL_QUESTION_STATES
  const stateParam = params.get('state')
  if (stateParam) {
    const requested = stateParam.split(',').map((s) => s.trim()).filter(Boolean)
    const invalid = requested.find((s) => !VALID_STATES.has(s))
    if (invalid) return NextResponse.json({ error: `Invalid state: ${invalid}` }, { status: 400 })
    states = requested as QuestionState[]
  }

  const filters: SearchFilters = { states }

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
    return mapError(err, '[GET /api/admin/questions/search]')
  }
}
