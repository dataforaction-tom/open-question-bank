import { NextResponse } from 'next/server'
import { endorseSynthesis } from '@/lib/synthesis'
import { mapError } from '@/lib/api-errors'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; synthesisId: string }> },
) {
  const { synthesisId } = await params
  try {
    return NextResponse.json({ synthesis: await endorseSynthesis(synthesisId, 'admin') })
  } catch (err) {
    return mapError(err, '[POST .../syntheses/:synthesisId/endorse]')
  }
}
