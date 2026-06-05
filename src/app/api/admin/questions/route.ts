import { NextResponse } from 'next/server'
import { listPending } from '@/lib/moderation'
import { listClustered } from '@/lib/refinement'

export async function GET(request: Request) {
  const state = new URL(request.url).searchParams.get('state') ?? 'submitted'
  if (state === 'submitted') {
    return NextResponse.json({ questions: await listPending() })
  }
  if (state === 'clustered') {
    return NextResponse.json({ questions: await listClustered() })
  }
  return NextResponse.json({ error: 'Only state=submitted or state=clustered is supported' }, { status: 400 })
}
