import { NextResponse } from 'next/server'
import { getPublicCampaign } from '@/lib/discovery'
import { mapPublicError } from '@/lib/api-errors'

/** Public basic info for a campaign in a public state (open/comparing/closed). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    return NextResponse.json(await getPublicCampaign(id))
  } catch (err) {
    return mapPublicError(err, '[GET /api/campaigns/:id]')
  }
}
