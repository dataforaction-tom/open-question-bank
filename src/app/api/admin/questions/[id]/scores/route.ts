import { NextResponse } from 'next/server'
import { currentScores, listScores } from '@/lib/curation'
import { NotFoundError } from '@/lib/errors'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const history = await listScores(id)
    return NextResponse.json({ current: currentScores(history), history })
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    console.error('[GET /api/admin/questions/:id/scores]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
