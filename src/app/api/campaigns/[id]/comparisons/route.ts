import { NextResponse } from 'next/server'
import { getOrCreateJudgeRef, JUDGE_COOKIE, judgeCookieOptions } from '@/lib/judge'
import { recordComparison } from '@/lib/comparison'
import { mapPublicError } from '@/lib/api-errors'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { judgeRef, isNew } = getOrCreateJudgeRef(request)
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
  if (b.winnerQuestionId != null && typeof b.winnerQuestionId !== 'string') {
    return NextResponse.json({ error: 'winnerQuestionId must be a string id or null' }, { status: 400 })
  }
  const winnerQuestionId = (b.winnerQuestionId as string | null | undefined) ?? null
  try {
    await recordComparison({
      campaignId: id,
      questionAId: b.questionAId,
      questionBId: b.questionBId,
      winnerQuestionId,
      judgeRef,
      servedReason: typeof b.servedReason === 'string' ? b.servedReason : null,
    })
    const res = NextResponse.json({ ok: true })
    if (isNew) res.cookies.set(JUDGE_COOKIE, judgeRef, judgeCookieOptions())
    return res
  } catch (err) {
    return mapPublicError(err, '[POST /api/campaigns/:id/comparisons]')
  }
}
