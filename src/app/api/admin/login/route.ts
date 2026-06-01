import { NextResponse } from 'next/server'
import { checkPassword, createSessionToken, SESSION_COOKIE, sessionCookieOptions } from '@/lib/admin-auth'

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const password = (body as { password?: unknown }).password
  if (typeof password !== 'string' || !checkPassword(password)) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }
  const token = await createSessionToken()
  const res = NextResponse.json({ status: 'ok' })
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions())
  return res
}
