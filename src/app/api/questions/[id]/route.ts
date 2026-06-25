import { NextResponse } from 'next/server'
import { getPublicQuestion } from '@/lib/discovery'
import { mapPublicError } from '@/lib/api-errors'

/** Public detail for a single published (canonical/ranked) question. Anonymised. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    return NextResponse.json(await getPublicQuestion(id))
  } catch (err) {
    return mapPublicError(err, '[GET /api/questions/:id]')
  }
}
