import { NextResponse } from 'next/server'
import { scoreQuestion } from '@/lib/curation'
import { IneligibleError, NotFoundError } from '@/lib/errors'
import { ProviderError } from '@/lib/llm'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const scores = await scoreQuestion(id)
    return NextResponse.json({ scores })
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (err instanceof IneligibleError) return NextResponse.json({ error: 'Not clustered' }, { status: 409 })
    // 502 is reserved for the LLM call itself (transport or output validation, spec §7);
    // anything else — e.g. a DB failure after a successful score — is a plain 500.
    if (err instanceof ProviderError) {
      console.error('[POST /api/admin/questions/:id/score]', err)
      return NextResponse.json({ error: 'Scoring service unavailable' }, { status: 502 })
    }
    console.error('[POST /api/admin/questions/:id/score]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
