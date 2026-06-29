import { NextResponse } from 'next/server'
import { questionGraph } from '@/lib/browse'
import { mapPublicError } from '@/lib/api-errors'

/**
 * Public question relationship graph: nodes are published questions (canonical/ranked),
 * edges connect questions sharing a cluster. Anonymised — no submitter refs or embeddings.
 * Capped at 200 nodes for render performance.
 */
export async function GET() {
  try {
    return NextResponse.json(await questionGraph())
  } catch (err) {
    return mapPublicError(err, '[GET /api/browse/graph]')
  }
}