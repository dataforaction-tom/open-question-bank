// Anonymous, unlinkable judge identity over an opaque random cookie token.
// Not a privilege (no HMAC) — it only distinguishes one browser's judgements
// from another's and is resettable by clearing cookies.

export const JUDGE_COOKIE = 'qb_judge'

export function judgeCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // ~1 year
    secure: process.env.NODE_ENV === 'production',
  }
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) {
      const value = decodeURIComponent(part.slice(eq + 1).trim())
      return value === '' ? undefined : value // an empty cookie counts as absent
    }
  }
  return undefined
}

/**
 * Read the judge token from the request cookie, or mint a fresh one. The caller
 * sets the cookie on the response when `isNew` is true.
 */
export function getOrCreateJudgeRef(request: Request): { judgeRef: string; isNew: boolean } {
  const existing = readCookie(request, JUDGE_COOKIE)
  if (existing) return { judgeRef: existing, isNew: false }
  return { judgeRef: crypto.randomUUID(), isNew: true }
}
