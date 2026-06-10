import { NextResponse } from 'next/server'
import { promoteToCanonical } from '@/lib/curation'
import { IneligibleError, NotFoundError } from '@/lib/errors'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const updated = await promoteToCanonical(id, 'admin') // single shared admin account, as in Slices 2–3
    return NextResponse.json({ status: 'canonical', question: updated })
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (err instanceof IneligibleError) return NextResponse.json({ error: 'Not clustered' }, { status: 409 })
    console.error('[POST /api/admin/questions/:id/promote]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
