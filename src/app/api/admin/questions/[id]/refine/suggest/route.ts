import { NextResponse } from 'next/server'
import { IneligibleError, NotFoundError, suggestRefinement } from '@/lib/refinement'
import { ProviderError } from '@/lib/llm'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const result = await suggestRefinement(id)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (err instanceof IneligibleError) return NextResponse.json({ error: 'Not clustered' }, { status: 409 })
    // 502 is reserved for the LLM call itself (transport or output validation);
    // anything else — e.g. a DB failure — is a plain 500. Matches the score route.
    if (err instanceof ProviderError) {
      console.error('[POST /api/admin/questions/:id/refine/suggest]', err)
      return NextResponse.json({ error: 'Refinement service unavailable' }, { status: 502 })
    }
    console.error('[POST /api/admin/questions/:id/refine/suggest]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
