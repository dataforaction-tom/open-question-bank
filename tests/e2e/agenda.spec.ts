import { test, expect } from '@playwright/test'

// Admin sets up, runs, and CLOSES a campaign; an ANONYMOUS context views the
// published agenda and its evidence — proving the public read surface needs no login.
test('a closed campaign publishes a public ranked agenda', async ({ page, browser }) => {
  const password = process.env.ADMIN_PASSWORD ?? 'admin'
  // Collision-proof, non-overlapping tag (see judge.spec.ts).
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
  const a = await makeCanonical(`agenda option A ${stamp}`)
  const b = await makeCanonical(`agenda option B ${stamp}`)

  const created = await page.request.post('/api/admin/campaigns', {
    data: { prompt: `agenda campaign ${stamp}`, comparisonAxis: 'importance' },
  })
  const { campaign } = await created.json()
  await page.request.post(`/api/admin/campaigns/${campaign.id}/questions`, {
    data: { questionIds: [a, b] },
  })
  await page.request.post(`/api/admin/campaigns/${campaign.id}/open`)
  // A judges over B, then close.
  await page.request.post(`/api/admin/campaigns/${campaign.id}/comparisons`, {
    data: { questionAId: a, questionBId: b, winnerQuestionId: a },
  })
  await page.request.post(`/api/admin/campaigns/${campaign.id}/close`)

  // Anonymous viewer — fresh context, no admin cookie.
  const anon = await browser.newContext()
  const vp = await anon.newPage()
  await vp.goto(`/campaigns/${campaign.id}`)
  await expect(vp.getByRole('heading', { name: `agenda campaign ${stamp}` })).toBeVisible()

  // A won every comparison, so it ranks #1 and reads as the clear favourite in plain language.
  const top = vp.locator('li', { hasText: `agenda option A ${stamp}` })
  await expect(top).toContainText('#1')
  await expect(top.getByText('Clear favourite')).toBeVisible()

  // The academic detail (μ/σ) is NOT visible by default — it lives in the collapsed disclosure.
  await expect(vp.getByText(/μ/).first()).not.toBeVisible()
  // Expanding "How was this ranked?" reveals the chart/table (μ becomes visible).
  await vp.getByText('How was this ranked?').click()
  await expect(vp.getByText('Ranking confidence').first()).toBeVisible()

  // Evidence is plain language: A was "Chosen over" B.
  await top.getByRole('button', { name: 'Show evidence' }).click()
  await expect(top.getByText('Chosen over')).toBeVisible()
  await anon.close()
})
