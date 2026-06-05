import { NextResponse } from 'next/server'
import { listRefinements } from '@/lib/refinement'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return NextResponse.json({ refinements: await listRefinements(id) })
}
