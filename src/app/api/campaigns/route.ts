import { NextResponse } from 'next/server'
import { listPublicCampaigns } from '@/lib/discovery'
import { mapPublicError } from '@/lib/api-errors'

export async function GET() {
  try {
    return NextResponse.json(await listPublicCampaigns())
  } catch (err) {
    return mapPublicError(err, '[GET /api/campaigns]')
  }
}
