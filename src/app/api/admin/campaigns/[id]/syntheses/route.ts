import { NextResponse } from 'next/server'
import { listSyntheses, proposeSyntheses } from '@/lib/synthesis'
import { ProviderError } from '@/lib/llm'
import { mapError } from '@/lib/api-errors'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const syntheses = await proposeSyntheses(id)
    return NextResponse.json({ syntheses })
  } catch (err) {
    if (err instanceof ProviderError) {
      console.error('[POST /api/admin/campaigns/:id/syntheses]', err)
      return NextResponse.json({ error: 'Synthesis service unavailable' }, { status: 502 })
    }
    return mapError(err, '[POST /api/admin/campaigns/:id/syntheses]')
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    return NextResponse.json({ syntheses: await listSyntheses(id) })
  } catch (err) {
    return mapError(err, '[GET /api/admin/campaigns/:id/syntheses]')
  }
}
