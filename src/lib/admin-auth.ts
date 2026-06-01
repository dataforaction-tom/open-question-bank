// Stateless admin session over an HMAC-signed cookie. Uses Web Crypto (crypto.subtle) and
// btoa/atob only, so the same code runs in Node route handlers AND the Edge middleware.

const encoder = new TextEncoder()
const SESSION_TTL_SECONDS = 12 * 60 * 60

export const SESSION_COOKIE = 'qb_admin_session'

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
    secure: process.env.NODE_ENV === 'production',
  }
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function getSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET
  if (!secret) throw new Error('ADMIN_SESSION_SECRET is not set')
  return secret
}

async function sign(payloadB64: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64))
  return bytesToB64url(new Uint8Array(sig))
}

/** Issue a signed session token. ttlSeconds is overridable for tests. */
export async function createSessionToken(ttlSeconds: number = SESSION_TTL_SECONDS): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const payload = { iat: now, exp: now + ttlSeconds }
  const payloadB64 = bytesToB64url(encoder.encode(JSON.stringify(payload)))
  const sig = await sign(payloadB64)
  return `${payloadB64}.${sig}`
}

/** Verify a session token's signature and expiry. Never throws — a missing secret or a
 *  malformed token is treated as unauthenticated, so the middleware returns 401 instead of crashing. */
export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [payloadB64, sig] = parts
  try {
    const expected = await sign(payloadB64) // may throw if ADMIN_SESSION_SECRET is unset
    if (!constantTimeEqual(sig, expected)) return false
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64))) as { exp?: number }
    return typeof payload.exp === 'number' && payload.exp > Math.floor(Date.now() / 1000)
  } catch {
    return false
  }
}

/** Constant-time compare of a candidate password to ADMIN_PASSWORD. */
export function checkPassword(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD
  if (!expected) throw new Error('ADMIN_PASSWORD is not set')
  return constantTimeEqual(candidate, expected)
}
