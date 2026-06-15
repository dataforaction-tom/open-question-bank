import { NextResponse } from 'next/server'
import { removeQuestion } from '@/lib/campaign'
import { mapError } from '@/lib/api-errors'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; questionId: string }> },
) {
  const { id, questionId } = await params
  try {
    await removeQuestion(id, questionId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return mapError(err, '[DELETE /api/admin/campaigns/:id/questions/:questionId]')
  }
}
