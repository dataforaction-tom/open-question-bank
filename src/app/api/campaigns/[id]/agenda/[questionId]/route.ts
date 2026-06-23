import { NextResponse } from 'next/server'
import { getQuestionEvidence } from '@/lib/agenda'
import { IneligibleError, NotFoundError } from '@/lib/errors'
import { mapPublicError } from '@/lib/api-errors'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; questionId: string }> },
) {
  const { id, questionId } = await params
  try {
    return NextResponse.json({ evidence: await getQuestionEvidence(id, questionId) })
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (err instanceof IneligibleError) {
      return NextResponse.json({ error: 'This campaign’s agenda is not published yet' }, { status: 409 })
    }
    return mapPublicError(err, '[GET /api/campaigns/:id/agenda/:questionId]')
  }
}
