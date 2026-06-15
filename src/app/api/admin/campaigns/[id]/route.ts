import { NextResponse } from 'next/server'
import { getCampaign } from '@/lib/campaign'
import { mapError } from '@/lib/api-errors'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    return NextResponse.json(await getCampaign(id))
  } catch (err) {
    return mapError(err, '[GET /api/admin/campaigns/:id]')
  }
}
