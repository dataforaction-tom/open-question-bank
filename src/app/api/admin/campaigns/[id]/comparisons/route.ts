import { NextResponse } from 'next/server'
import { recordComparison } from '@/lib/comparison'
import { mapError } from '@/lib/api-errors'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const b = body as Record<string, unknown>
  if (typeof b?.questionAId !== 'string' || typeof b?.questionBId !== 'string') {
    return NextResponse.json({ error: 'questionAId and questionBId are required' }, { status: 400 })
  }
  // winner is a question id, or null/absent for a draw — reject other types at the boundary
  // so a bad payload is a clear 400, not a misleading 409 from the domain layer.
  if (b.winnerQuestionId != null && typeof b.winnerQuestionId !== 'string') {
    return NextResponse.json({ error: 'winnerQuestionId must be a string id or null' }, { status: 400 })
  }
  const winnerQuestionId = (b.winnerQuestionId as string | null | undefined) ?? null
  try {
    const result = await recordComparison({
      campaignId: id,
      questionAId: b.questionAId,
      questionBId: b.questionBId,
      winnerQuestionId,
      judgeRef: 'admin',
      servedReason: typeof b.servedReason === 'string' ? b.servedReason : null,
    })
    return NextResponse.json(result)
  } catch (err) {
    return mapError(err, '[POST /api/admin/campaigns/:id/comparisons]')
  }
}
