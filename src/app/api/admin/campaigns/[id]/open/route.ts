import { NextResponse } from 'next/server'
import { openComparison } from '@/lib/campaign'
import { mapError } from '@/lib/api-errors'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    return NextResponse.json({ campaign: await openComparison(id) })
  } catch (err) {
    return mapError(err, '[POST /api/admin/campaigns/:id/open]')
  }
}
