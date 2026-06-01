import { NextResponse } from 'next/server'
import { checkPassword, createSessionToken, SESSION_COOKIE, sessionCookieOptions } from '@/lib/admin-auth'

// Single-operator admin login throttle (per server instance, in-memory).
const LOCKOUT_WINDOW_MS = 5 * 60 * 1000
const MAX_FAILURES = 10
let recentFailures: number[] = []

function isLockedOut(now: number): boolean {
  recentFailures = recentFailures.filter((t) => t > now - LOCKOUT_WINDOW_MS)
  return recentFailures.length >= MAX_FAILURES
}

export async function POST(request: Request) {
  const now = Date.now()
  if (isLockedOut(now)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const password = (body as { password?: unknown }).password
  if (typeof password !== 'string' || !checkPassword(password)) {
    await new Promise((r) => setTimeout(r, 250))
    recentFailures.push(now)
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }
  recentFailures = []
  const token = await createSessionToken()
  const res = NextResponse.json({ status: 'ok' })
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions())
  return res
}
