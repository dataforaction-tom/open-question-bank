import { NextResponse } from 'next/server'
import {
  recentQuestions, topOfRecentCampaigns, mostAskedQuestions, themeCounts,
} from '@/lib/browse'
import { mapPublicError } from '@/lib/api-errors'

export async function GET() {
  try {
    const [recent, topOfCampaigns, mostAsked, themes] = await Promise.all([
      recentQuestions(),
      topOfRecentCampaigns(),
      mostAskedQuestions(),
      themeCounts(),
    ])
    return NextResponse.json({ recent, topOfCampaigns, mostAsked, themes })
  } catch (err) {
    return mapPublicError(err, '[GET /api/browse]')
  }
}
