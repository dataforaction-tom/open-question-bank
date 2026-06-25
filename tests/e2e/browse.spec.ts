import { test, expect } from '@playwright/test'

// An anonymous visitor lands on /browse, sees curated rails by default, can search (rails ->
// results -> back), and can drill into a theme. Builds its own data via the admin API.
test('browse shows rails, search, and theme drill-in', async ({ page, browser }) => {
  const password = process.env.ADMIN_PASSWORD ?? 'admin'
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  await page.goto('/admin/login')
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /log in/i }).click()
  await expect(page).toHaveURL(/\/admin\/moderation/)

  // Create + approve + promote a canonical, themed question via the admin API (mock provider
  // classifies it on approval).
  const text = `should we add protected cycle lanes for ${stamp}?`
  const created = await page.request.post('/api/questions', {
    data: { rawText: text, visibility: 'public', decision: { type: 'new' } },
  })
  const { question } = await created.json()
  await page.request.post(`/api/admin/questions/${question.id}/approve`)
  await page.request.post(`/api/admin/questions/${question.id}/promote`)

  const anon = await browser.newContext()
  const vp = await anon.newPage()

  // Rails by default.
  await vp.goto('/browse')
  await expect(vp.getByRole('heading', { name: 'Most recent' })).toBeVisible()
  await expect(vp.getByText(text)).toBeVisible()

  // Search swaps rails -> results, then back.
  await vp.getByLabel('Search').fill('cycle lanes')
  await vp.getByRole('button', { name: 'Search' }).click()
  await expect(vp.getByText(text)).toBeVisible()
  await vp.getByRole('button', { name: /Back to browse/ }).click()
  await expect(vp.getByRole('heading', { name: 'Most recent' })).toBeVisible()

  // Theme drill-in: the Transport chip shows at least one question.
  await vp.getByRole('button', { name: /Transport & Streets/ }).click()
  await expect(vp.getByText(text)).toBeVisible()
  await anon.close()
})
