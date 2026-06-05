import { NextResponse } from 'next/server'
import { IneligibleError, NotFoundError, suggestRefinement } from '@/lib/refinement'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const result = await suggestRefinement(id)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (err instanceof IneligibleError) return NextResponse.json({ error: 'Not clustered' }, { status: 409 })
    // Remaining failures are the LLM call itself (transport or output validation).
    console.error('[POST /api/admin/questions/:id/refine/suggest]', err)
    return NextResponse.json({ error: 'Refinement service unavailable' }, { status: 502 })
  }
}
