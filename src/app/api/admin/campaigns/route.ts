import { NextResponse } from 'next/server'
import { createCampaign, listCampaigns } from '@/lib/campaign'
import { mapError } from '@/lib/api-errors'

export async function GET() {
  try {
    return NextResponse.json({ campaigns: await listCampaigns() })
  } catch (err) {
    return mapError(err, '[GET /api/admin/campaigns]')
  }
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const b = body as Record<string, unknown>
  const prompt = typeof b?.prompt === 'string' ? b.prompt.trim() : ''
  const comparisonAxis = typeof b?.comparisonAxis === 'string' ? b.comparisonAxis.trim() : ''
  if (!prompt || !comparisonAxis) {
    return NextResponse.json({ error: 'prompt and comparisonAxis are required' }, { status: 400 })
  }
  try {
    const campaign = await createCampaign({ prompt, comparisonAxis })
    return NextResponse.json({ campaign }, { status: 201 })
  } catch (err) {
    return mapError(err, '[POST /api/admin/campaigns]')
  }
}
