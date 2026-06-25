import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prepareSubmission, createQuestion, type SubmitInput } from '@/lib/submission'
import { listPublicQuestions } from '@/lib/discovery'
import { questionsByTheme } from '@/lib/browse'
import { mapPublicError } from '@/lib/api-errors'
import { IneligibleError, NotFoundError } from '@/lib/errors'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuid = z.string().regex(UUID_RE, 'must be a UUID')

// Submission body. `decision` is the submitter's choice after dedup-at-source:
//  - omitted → run dedup ("yours or new?")
//  - { type: 'new' } → force-create a fresh question
//  - { type: 'merge', canonicalId } → store as a variant of the chosen question
// `campaignId` (optional) is the campaign the question is submitted INTO — a curation signal.
const bodySchema = z.object({
  rawText: z.string().trim().min(1).max(2000),
  visibility: z.enum(['anonymous', 'public']),
  submitterRef: z.string().nullish(),
  campaignId: uuid.optional(),
  decision: z
    .union([
      z.object({ type: z.literal('new') }),
      z.object({ type: z.literal('merge'), canonicalId: uuid }),
    ])
    .optional(),
})

export async function GET(request: Request) {
  try {
    const theme = new URL(request.url).searchParams.get('theme')
    if (theme) {
      return NextResponse.json({ questions: await questionsByTheme(theme) })
    }
    return NextResponse.json({ questions: await listPublicQuestions() })
  } catch (err) {
    return mapPublicError(err, '[GET /api/questions]')
  }
}

export async function POST(request: Request) {
  // TODO (later slice): add rate limiting / fingerprinting for this public submission surface.
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'rawText (non-empty) and visibility ("anonymous" | "public") are required' },
      { status: 400 },
    )
  }
  const body = parsed.data

  const input: SubmitInput = {
    rawText: body.rawText.trim(),
    visibility: body.visibility,
    submitterRef: body.submitterRef ?? null,
    originatingCampaignId: body.campaignId ?? null,
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
      const variant = await createQuestion(input, { mergeInto: body.decision.canonicalId })
      return NextResponse.json(
        { status: 'merged', question: { id: variant.id, canonicalText: variant.canonicalText } },
        { status: 201 },
      )
    }
    const result = await prepareSubmission(input)
    return NextResponse.json(result, { status: result.status === 'created' ? 201 : 200 })
  } catch (err) {
    // A bad/closed campaign target is a client problem — surface it rather than a generic 500.
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: 'That campaign was not found' }, { status: 404 })
    }
    if (err instanceof IneligibleError) {
      return NextResponse.json({ error: 'That campaign is not open for submission' }, { status: 409 })
    }
    console.error('[POST /api/questions]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
