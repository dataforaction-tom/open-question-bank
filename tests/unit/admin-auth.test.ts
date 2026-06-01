import { beforeAll, describe, expect, it } from 'vitest'
import { checkPassword, createSessionToken, verifySessionToken } from '@/lib/admin-auth'

beforeAll(() => {
  process.env.ADMIN_PASSWORD = 'hunter2'
  process.env.ADMIN_SESSION_SECRET = 'test-secret-long-enough-0123456789'
})

describe('session tokens', () => {
  it('verifies a freshly issued token', async () => {
    const token = await createSessionToken()
    expect(await verifySessionToken(token)).toBe(true)
  })

  it('rejects a tampered token', async () => {
    const token = await createSessionToken()
    const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a')
    expect(await verifySessionToken(tampered)).toBe(false)
  })

  it('rejects an expired token', async () => {
    const expired = await createSessionToken(-10)
    expect(await verifySessionToken(expired)).toBe(false)
  })

  it('rejects undefined / malformed tokens', async () => {
    expect(await verifySessionToken(undefined)).toBe(false)
    expect(await verifySessionToken('not-a-token')).toBe(false)
  })
})

describe('checkPassword', () => {
  it('accepts the configured password and rejects others', () => {
    expect(checkPassword('hunter2')).toBe(true)
    expect(checkPassword('wrong')).toBe(false)
  })
})
