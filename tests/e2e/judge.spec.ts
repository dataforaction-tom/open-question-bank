import { test, expect } from '@playwright/test'

// Admin sets up an open campaign via API; an ANONYMOUS browser context (no admin
// cookie) does the judging, proving the public surface needs no login.
test('a logged-out judge compares a pair', async ({ page, browser }) => {
  const password = process.env.ADMIN_PASSWORD ?? 'admin'
  // Unique, collision-proof tag: a random suffix avoids a same-millisecond clash
  // with other parallel specs, and the prefix shares no substring with the
  // admin-campaigns spec's identifiers (so neither test's hasText matches the other).
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  await page.goto('/admin/login')
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /log in/i }).click()
  await expect(page).toHaveURL(/\/admin\/moderation/)

  async function makeCanonical(text: string): Promise<string> {
    const created = await page.request.post('/api/questions', {
      data: { rawText: text, visibility: 'public', decision: { type: 'new' } },
    })
    const { question } = await created.json()
    await page.request.post(`/api/admin/questions/${question.id}/approve`)
    await page.request.post(`/api/admin/questions/${question.id}/promote`)
    return question.id
  }
  const a = await makeCanonical(`judge option A ${stamp}`)
  const b = await makeCanonical(`judge option B ${stamp}`)

  const created = await page.request.post('/api/admin/campaigns', {
    data: { prompt: `public judging ${stamp}`, comparisonAxis: 'importance' },
  })
  const { campaign } = await created.json()
  await page.request.post(`/api/admin/campaigns/${campaign.id}/questions`, {
    data: { questionIds: [a, b] },
  })
  await page.request.post(`/api/admin/campaigns/${campaign.id}/open`)

  // Anonymous judge — fresh context with no admin session cookie.
  const anon = await browser.newContext()
  const jp = await anon.newPage()
  await jp.goto(`/judge/${campaign.id}`)
  await expect(jp.getByRole('heading', { name: `public judging ${stamp}` })).toBeVisible()
  await jp.getByRole('button', { name: new RegExp(`judge option [AB] ${stamp}`) }).first().click()
  // Only one pair exists; once judged, the judge has none left.
  await expect(jp.getByText(/no more pairs/i)).toBeVisible()

  // The judge cookie persists server-side state across a reload: still no pairs.
  await jp.reload()
  await expect(jp.getByText(/no more pairs/i)).toBeVisible()

  await anon.close()

  // A campaign that is not open (draft) shows the unavailable message, not a pair.
  const draft = await page.request.post('/api/admin/campaigns', {
    data: { prompt: `public judging draft ${stamp}`, comparisonAxis: 'importance' },
  })
  const draftId = (await draft.json()).campaign.id
  const anon2 = await browser.newContext()
  const dp = await anon2.newPage()
  await dp.goto(`/judge/${draftId}`)
  await expect(dp.getByText(/not open for comparison/i)).toBeVisible()
  await anon2.close()
})
