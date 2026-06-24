import { NextResponse } from 'next/server'
import { prepareSubmission, createQuestion, type SubmitInput } from '@/lib/submission'
import { listPublicQuestions } from '@/lib/discovery'
import { mapPublicError } from '@/lib/api-errors'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RequestBody extends SubmitInput {
  // Submitter's decision after seeing candidates:
  //  - undefined → run dedup-at-source
  //  - { type: 'new' } → force-create a fresh question
  //  - { type: 'merge', canonicalId } → store as a variant of the chosen question
  decision?: { type: 'new' } | { type: 'merge'; canonicalId: string }
}

function isValid(body: unknown): body is RequestBody {
  if (typeof body !== 'object' || body === null) return false
  const b = body as Record<string, unknown>
  if (typeof b.rawText !== 'string' || b.rawText.trim().length === 0) return false
  if (b.rawText.trim().length > 2000) return false // questions are short; reject oversized input
  if (b.visibility !== 'anonymous' && b.visibility !== 'public') return false
  return true
}

export async function GET() {
  try {
    return NextResponse.json({ questions: await listPublicQuestions() })
  } catch (err) {
    return mapPublicError(err, '[GET /api/questions]')
  }
}

export async function POST(request: Request) {
  // TODO (later slice): add rate limiting / fingerprinting for this public submission surface.
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!isValid(body)) {
    return NextResponse.json(
      { error: 'rawText (non-empty) and visibility ("anonymous" | "public") are required' },
      { status: 400 },
    )
  }

  const input: SubmitInput = {
    rawText: body.rawText.trim(),
    visibility: body.visibility,
    submitterRef: typeof body.submitterRef === 'string' ? body.submitterRef : null,
  }

  try {
    if (body.decision?.type === 'new') {
      const created = await createQuestion(input)
      return NextResponse.json(
        { status: 'created', question: { id: created.id, canonicalText: created.canonicalText } },
        { status: 201 },
      )
    }
    if (body.decision?.type === 'merge') {
      if (!UUID_RE.test(body.decision.canonicalId)) {
        return NextResponse.json({ error: 'Invalid canonicalId' }, { status: 400 })
      }
      const variant = await createQuestion(input, { mergeInto: body.decision.canonicalId })
      return NextResponse.json(
        { status: 'merged', question: { id: variant.id, canonicalText: variant.canonicalText } },
        { status: 201 },
      )
    }
    const result = await prepareSubmission(input)
    return NextResponse.json(result, { status: result.status === 'created' ? 201 : 200 })
  } catch (err) {
    console.error('[POST /api/questions]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
