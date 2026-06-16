import { NextResponse } from 'next/server'
import { nextPair } from '@/lib/comparison'
import { mapError } from '@/lib/api-errors'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    return NextResponse.json({ pair: await nextPair(id, 'admin') })
  } catch (err) {
    return mapError(err, '[GET /api/admin/campaigns/:id/pair]')
  }
}
