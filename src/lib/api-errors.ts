import { NextResponse } from 'next/server'
import { IneligibleError, NotFoundError } from '@/lib/errors'

/**
 * Map a thrown domain error to the response shape the admin API uses everywhere.
 * IneligibleError messages are surfaced verbatim by design — they are written as
 * admin-facing validation text (e.g. "needs at least 2 questions to open") and the
 * admin UI shows them directly. These routes are admin-only (middleware-guarded).
 */
export function mapError(err: unknown, tag: string): NextResponse {
  if (err instanceof NotFoundError) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (err instanceof IneligibleError) return NextResponse.json({ error: err.message }, { status: 409 })
  console.error(tag, err)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

/**
 * Public (anonymous) variant: generic messages only — never leak internal state
 * strings (campaign ids, lifecycle state) to unauthenticated users.
 */
export function mapPublicError(err: unknown, tag: string): NextResponse {
  if (err instanceof NotFoundError) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (err instanceof IneligibleError) {
    return NextResponse.json({ error: 'That comparison could not be recorded' }, { status: 409 })
  }
  console.error(tag, err)
  return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
}
