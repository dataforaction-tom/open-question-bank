import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { campaign } from '@/db/schema'
import { getOrCreateJudgeRef, JUDGE_COOKIE, judgeCookieOptions } from '@/lib/judge'
import { nextPair } from '@/lib/comparison'
import { mapPublicError } from '@/lib/api-errors'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { judgeRef, isNew } = getOrCreateJudgeRef(request)
  const [c] = await db.select().from(campaign).where(eq(campaign.id, id)).limit(1)
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (c.state !== 'comparing') {
    return NextResponse.json({ error: 'This campaign is not open for comparison' }, { status: 409 })
  }
  try {
    // nextPair re-reads the campaign and can throw if it closed between the check
    // above and here (TOCTOU), or on a DB error — keep it a clean public response.
    const pair = await nextPair(id, judgeRef)
    const res = NextResponse.json({
      campaign: { prompt: c.prompt, comparisonAxis: c.comparisonAxis },
      pair,
    })
    if (isNew) res.cookies.set(JUDGE_COOKIE, judgeRef, judgeCookieOptions())
    return res
  } catch (err) {
    return mapPublicError(err, '[GET /api/campaigns/:id/pair]')
  }
}
