import { NextResponse } from 'next/server'
import { IneligibleError, NotFoundError, recordRefinement } from '@/lib/refinement'

const ACTIONS = ['accept', 'reject', 'edit'] as const

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const action = body.action
  if (typeof action !== 'string' || !ACTIONS.includes(action as (typeof ACTIONS)[number])) {
    return NextResponse.json({ error: 'action must be accept | reject | edit' }, { status: 400 })
  }
  if (typeof body.before !== 'string') {
    return NextResponse.json({ error: 'before is required' }, { status: 400 })
  }
  if ((action === 'accept' || action === 'edit') && typeof body.finalText !== 'string') {
    return NextResponse.json({ error: 'finalText is required for accept/edit' }, { status: 400 })
  }

  try {
    const row = await recordRefinement({
      questionId: id,
      action: action as (typeof ACTIONS)[number],
      before: body.before,
      llmSuggestedText: typeof body.llmSuggestedText === 'string' ? body.llmSuggestedText : null,
      finalText: typeof body.finalText === 'string' ? body.finalText : null,
      criteriaApplied: Array.isArray(body.criteriaApplied) ? (body.criteriaApplied as string[]) : [],
      critique: Array.isArray(body.critique)
        ? (body.critique as { criterion: string; verdict: 'pass' | 'fail'; note: string }[])
        : [],
      rationale: typeof body.rationale === 'string' ? body.rationale : '',
      model: typeof body.model === 'string' ? body.model : null,
      modelVersion: typeof body.modelVersion === 'string' ? body.modelVersion : null,
      actorRef: 'admin', // single shared admin account this slice (matches Slice 2)
    })
    return NextResponse.json({ refinement: row })
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (err instanceof IneligibleError) return NextResponse.json({ error: 'Not clustered' }, { status: 409 })
    console.error('[POST /api/admin/questions/:id/refine]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
