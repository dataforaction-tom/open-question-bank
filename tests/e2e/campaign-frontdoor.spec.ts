import { test, expect } from '@playwright/test'

// Admin opens a campaign for submission; an ANONYMOUS visitor finds it on the public campaign
// index and submits a question INTO it via the per-campaign submit page.
test('the public can submit into an open campaign', async ({ page, browser }) => {
  const password = process.env.ADMIN_PASSWORD ?? 'admin'
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const prompt = `front-door campaign ${stamp}`

  await page.goto('/admin/login')
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /log in/i }).click()
  await expect(page).toHaveURL(/\/admin\/moderation/)

  // Create a campaign and open it for submission (via API, using the admin cookie).
  const created = await page.request.post('/api/admin/campaigns', {
    data: { prompt, comparisonAxis: 'importance' },
  })
  const { campaign } = await created.json()
  const opened = await page.request.post(`/api/admin/campaigns/${campaign.id}/open-submission`)
  expect(opened.ok()).toBeTruthy()

  // Anonymous visitor.
  const anon = await browser.newContext()
  const vp = await anon.newPage()

  await vp.goto('/campaigns')
  const row = vp.locator('li', { hasText: prompt })
  await expect(row).toBeVisible()
  await row.getByRole('link', { name: 'Submit a question →' }).click()

  await expect(vp).toHaveURL(new RegExp(`/campaigns/${campaign.id}/submit`))
  await expect(vp.getByRole('heading', { name: prompt })).toBeVisible()

  // Submit a unique question into the campaign.
  const questionText = `should we fund ${stamp} for the neighbourhood?`
  await vp.getByLabel('Your question').fill(questionText)
  await vp.getByRole('button', { name: 'Submit' }).click()

  // Unique text → no dedup match expected, but handle the "choose new" branch defensively.
  const chooseNew = vp.getByRole('button', { name: /None of these/ })
  if (await chooseNew.isVisible().catch(() => false)) await chooseNew.click()

  await expect(vp.getByText(/added|Thanks/i)).toBeVisible()
  await anon.close()
})
