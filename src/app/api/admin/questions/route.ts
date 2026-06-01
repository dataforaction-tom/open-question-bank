import { NextResponse } from 'next/server'
import { listPending } from '@/lib/moderation'

export async function GET(request: Request) {
  const state = new URL(request.url).searchParams.get('state') ?? 'submitted'
  if (state !== 'submitted') {
    return NextResponse.json({ error: 'Only state=submitted is supported' }, { status: 400 })
  }
  const questions = await listPending()
  return NextResponse.json({ questions })
}
