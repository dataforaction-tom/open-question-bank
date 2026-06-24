import { describe, expect, it } from 'vitest'
import { groupPublicCampaigns } from '@/lib/discovery'

const row = (id: string, state: string) => ({
  id,
  prompt: `p-${id}`,
  comparisonAxis: 'importance',
  closesAt: null,
  questionCount: 2,
  state,
})

describe('groupPublicCampaigns', () => {
  it('splits closed → published and comparing → openForJudging', () => {
    const { published, openForJudging } = groupPublicCampaigns([
      row('a', 'closed'),
      row('b', 'comparing'),
    ])
    expect(published.map((c) => c.id)).toEqual(['a'])
    expect(openForJudging.map((c) => c.id)).toEqual(['b'])
  })

  it('drops draft / open / synthesising campaigns', () => {
    const { published, openForJudging } = groupPublicCampaigns([
      row('d', 'draft'),
      row('o', 'open'),
      row('s', 'synthesising'),
    ])
    expect(published).toEqual([])
    expect(openForJudging).toEqual([])
  })

  it('strips the state field from the public items', () => {
    const { published } = groupPublicCampaigns([row('a', 'closed')])
    expect(published[0]).not.toHaveProperty('state')
    expect(published[0]).toMatchObject({ id: 'a', prompt: 'p-a', comparisonAxis: 'importance', questionCount: 2 })
  })
})
