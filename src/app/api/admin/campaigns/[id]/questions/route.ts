import { NextResponse } from 'next/server'
import { addQuestions } from '@/lib/campaign'
import { mapError } from '@/lib/api-errors'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const ids = (body as { questionIds?: unknown })?.questionIds
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) {
    return NextResponse.json({ error: 'questionIds (string[]) is required' }, { status: 400 })
  }
  try {
    await addQuestions(id, ids as string[])
    return NextResponse.json({ ok: true })
  } catch (err) {
    return mapError(err, '[POST /api/admin/campaigns/:id/questions]')
  }
}
