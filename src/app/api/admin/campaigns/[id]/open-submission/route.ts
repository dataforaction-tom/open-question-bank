import { NextResponse } from 'next/server'
import { openForSubmission } from '@/lib/campaign'
import { mapError } from '@/lib/api-errors'

/** Admin: open a draft campaign for public submission (draft → open). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    return NextResponse.json({ campaign: await openForSubmission(id) })
  } catch (err) {
    return mapError(err, '[POST /api/admin/campaigns/:id/open-submission]')
  }
}
