import { describe, expect, it } from 'vitest'
import { getOrCreateJudgeRef, JUDGE_COOKIE } from '@/lib/judge'

const req = (cookie?: string) =>
  new Request('http://localhost/', cookie ? { headers: { cookie } } : undefined)

describe('getOrCreateJudgeRef', () => {
  it('mints a new token when no cookie is present', () => {
    const { judgeRef, isNew } = getOrCreateJudgeRef(req())
    expect(isNew).toBe(true)
    expect(judgeRef).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('reuses an existing cookie token', () => {
    const { judgeRef, isNew } = getOrCreateJudgeRef(req(`${JUDGE_COOKIE}=abc-123`))
    expect(isNew).toBe(false)
    expect(judgeRef).toBe('abc-123')
  })

  it('mints unique tokens across calls', () => {
    expect(getOrCreateJudgeRef(req()).judgeRef).not.toBe(getOrCreateJudgeRef(req()).judgeRef)
  })

  it('picks out its own cookie among others', () => {
    const { judgeRef, isNew } = getOrCreateJudgeRef(req(`other=x; ${JUDGE_COOKIE}=tok; foo=bar`))
    expect(isNew).toBe(false)
    expect(judgeRef).toBe('tok')
  })

  it('treats an empty cookie value as absent and mints a new token', () => {
    expect(getOrCreateJudgeRef(req(`${JUDGE_COOKIE}=`)).isNew).toBe(true)
  })

  it('returns the first value when the cookie name is duplicated', () => {
    const { judgeRef } = getOrCreateJudgeRef(req(`${JUDGE_COOKIE}=first; ${JUDGE_COOKIE}=second`))
    expect(judgeRef).toBe('first')
  })
})
