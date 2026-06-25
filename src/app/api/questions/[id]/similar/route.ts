import { NextResponse } from 'next/server'
import { findSimilarQuestions } from '@/lib/similar'
import { mapPublicError } from '@/lib/api-errors'

/**
 * Public "find similar": nearest neighbours of a question among published (canonical/ranked)
 * questions, reusing existing embeddings (no re-embed). Anonymised.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const limitParam = Number(new URL(request.url).searchParams.get('limit') ?? '10')
  const limit = Number.isFinite(limitParam) ? limitParam : 10
  try {
    return NextResponse.json({ similar: await findSimilarQuestions(id, { limit }) })
  } catch (err) {
    return mapPublicError(err, '[GET /api/questions/:id/similar]')
  }
}
