import { NextResponse } from 'next/server'
import { listPending } from '@/lib/moderation'
import { listClustered } from '@/lib/refinement'
import { listCanonical } from '@/lib/campaign'
import { getVariantCounts } from '@/lib/submission'

export async function GET(request: Request) {
  const state = new URL(request.url).searchParams.get('state') ?? 'submitted'
  if (state === 'submitted') {
    return NextResponse.json({ questions: await listPending() })
  }
  if (state === 'clustered') {
    const questions = await listClustered()
    const counts = await getVariantCounts(questions.map((q) => q.id))
    return NextResponse.json({
      questions: questions.map((q) => ({ ...q, variantCount: counts.get(q.id) ?? 0 })),
    })
  }
  if (state === 'canonical') {
    const questions = await listCanonical()
    const counts = await getVariantCounts(questions.map((q) => q.id))
    return NextResponse.json({
      questions: questions.map((q) => ({ ...q, variantCount: counts.get(q.id) ?? 0 })),
    })
  }
  return NextResponse.json(
    { error: 'Only state=submitted, clustered, or canonical is supported' },
    { status: 400 },
  )
}
