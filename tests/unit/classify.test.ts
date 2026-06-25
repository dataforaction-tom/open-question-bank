import { describe, expect, it } from 'vitest'
import { MockProvider } from '@/lib/llm'
import { isTheme } from '@/lib/themes'

const mock = new MockProvider()

describe('MockProvider.classify', () => {
  it('maps clear keywords to the expected theme', async () => {
    const cases: [string, string][] = [
      ['Should we add protected cycle lanes near schools?', 'Transport & Streets'],
      ['Should new developments include affordable homes?', 'Housing'],
      ['How do we plant more street trees?', 'Climate & Environment'],
      ['How can we reduce loneliness for older people?', 'Health & Care'],
      ['What do teenagers need after school?', 'Youth & Education'],
      ['How do independent high street shops survive?', 'Local Economy'],
      ['How do we stop excluding people as services move online?', 'Digital & Services'],
      ['How do we make local decision-making more open?', 'Democracy & Voice'],
      ['How do neighbours get to know each other?', 'Community & Belonging'],
    ]
    for (const [text, theme] of cases) {
      expect((await mock.classify(text)).theme).toBe(theme)
    }
  })

  it('is deterministic and always returns a valid theme', async () => {
    const text = 'A question with no obvious keyword at all here'
    const a = await mock.classify(text)
    const b = await mock.classify(text)
    expect(a.theme).toBe(b.theme)
    expect(isTheme(a.theme)).toBe(true)
    expect(a.model).toBe('mock')
  })
})
