import { NextResponse } from 'next/server'
import { listEndorsedSyntheses } from '@/lib/synthesis'
import { IneligibleError, NotFoundError } from '@/lib/errors'
import { mapPublicError } from '@/lib/api-errors'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    return NextResponse.json({ syntheses: await listEndorsedSyntheses(id) })
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (err instanceof IneligibleError) {
      return NextResponse.json({ error: 'This campaign’s agenda is not published yet' }, { status: 409 })
    }
    return mapPublicError(err, '[GET /api/campaigns/:id/syntheses]')
  }
}
