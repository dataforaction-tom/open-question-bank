import { NextResponse } from 'next/server'
import { approveQuestion } from '@/lib/moderation'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const result = await approveQuestion(id, 'admin')
    return NextResponse.json({ status: 'clustered', ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (/not found/.test(message)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (/not pending/.test(message)) return NextResponse.json({ error: 'Not pending' }, { status: 409 })
    console.error('[POST /api/admin/questions/:id/approve]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
