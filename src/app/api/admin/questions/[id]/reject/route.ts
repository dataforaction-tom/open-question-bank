import { NextResponse } from 'next/server'
import { rejectQuestion } from '@/lib/moderation'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let reason: string | undefined
  try {
    const body = (await request.json()) as { reason?: unknown }
    if (typeof body.reason === 'string') reason = body.reason
  } catch {
    // no body is fine
  }
  try {
    await rejectQuestion(id, 'admin', reason) // single shared admin account this slice; becomes a real identity when multi-admin auth lands
    return NextResponse.json({ status: 'rejected' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (/not found/.test(message)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (/not pending/.test(message)) return NextResponse.json({ error: 'Not pending' }, { status: 409 })
    console.error('[POST /api/admin/questions/:id/reject]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
