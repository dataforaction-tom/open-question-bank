import { NextResponse } from 'next/server'
import { editSynthesis } from '@/lib/synthesis'
import { mapError } from '@/lib/api-errors'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; synthesisId: string }> },
) {
  const { synthesisId } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const text = (body as { text?: unknown })?.text
  if (typeof text !== 'string' || text.trim().length === 0) {
    return NextResponse.json({ error: 'text (non-empty) is required' }, { status: 400 })
  }
  try {
    return NextResponse.json({ synthesis: await editSynthesis(synthesisId, text.trim(), 'admin') })
  } catch (err) {
    return mapError(err, '[POST .../syntheses/:synthesisId/edit]')
  }
}
