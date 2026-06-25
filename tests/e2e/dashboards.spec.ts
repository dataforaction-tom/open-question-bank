import { test, expect } from '@playwright/test'

// Smoke-tests that the admin pipeline dashboard renders, and that a published agenda shows the
// public ranking-confidence dashboard (chart + its accessible data table).
test('dashboards render with data', async ({ page, browser }) => {
  const password = process.env.ADMIN_PASSWORD ?? 'admin'
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  await page.goto('/admin/login')
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /log in/i }).click()
  await expect(page).toHaveURL(/\/admin\/moderation/)

  // Admin dashboard renders.
  await page.goto('/admin/dashboard')
  await expect(page.getByRole('heading', { name: 'Pipeline health' })).toBeVisible()
  await expect(page.getByText('Questions by state')).toBeVisible()
  await expect(page.getByText('Awaiting moderation')).toBeVisible()

  // Build a published agenda so the public ranking-confidence dashboard has data.
  async function makeCanonical(text: string): Promise<string> {
    const created = await page.request.post('/api/questions', {
      data: { rawText: text, visibility: 'public', decision: { type: 'new' } },
    })
    const { question } = await created.json()
    await page.request.post(`/api/admin/questions/${question.id}/approve`)
    await page.request.post(`/api/admin/questions/${question.id}/promote`)
    return question.id
  }
  const a = await makeCanonical(`dash A ${stamp}`)
  const b = await makeCanonical(`dash B ${stamp}`)
  const created = await page.request.post('/api/admin/campaigns', {
    data: { prompt: `dash campaign ${stamp}`, comparisonAxis: 'importance' },
  })
  const campaign = (await created.json()).campaign
  await page.request.post(`/api/admin/campaigns/${campaign.id}/questions`, { data: { questionIds: [a, b] } })
  await page.request.post(`/api/admin/campaigns/${campaign.id}/open`)
  await page.request.post(`/api/admin/campaigns/${campaign.id}/comparisons`, {
    data: { questionAId: a, questionBId: b, winnerQuestionId: a },
  })
  await page.request.post(`/api/admin/campaigns/${campaign.id}/close`)

  // Public agenda shows the ranking-confidence dashboard.
  const anon = await browser.newContext()
  const vp = await anon.newPage()
  await vp.goto(`/campaigns/${campaign.id}`)
  await expect(vp.getByText('Ranking confidence')).toBeVisible()
  // The accessible data-table equivalent is present.
  await vp.getByText('Show data table').first().click()
  await expect(vp.getByRole('table').first()).toBeVisible()
  await anon.close()
})
