import { test, expect } from '@playwright/test'

// Requires the docker stack up + dev db seeded; the dev server runs with
// REASONING_PROVIDER=mock (playwright.config.ts) but this flow uses no model.
test('admin runs a campaign: create → add → open → compare', async ({ page }) => {
  const password = process.env.ADMIN_PASSWORD ?? 'admin'
  const stamp = Date.now()

  // Two canonical questions: submit → approve → promote, via API.
  async function makeCanonical(text: string): Promise<string> {
    const created = await page.request.post('/api/questions', {
      data: { rawText: text, visibility: 'public', decision: { type: 'new' } },
    })
    const { question } = await created.json()
    await page.request.post(`/api/admin/questions/${question.id}/approve`)
    await page.request.post(`/api/admin/questions/${question.id}/promote`)
    return question.id
  }

  // Log in first (sets the shared admin cookie used by page.request).
  await page.goto('/admin/login')
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /log in/i }).click()
  await expect(page).toHaveURL(/\/admin\/moderation/)

  await makeCanonical(`e2e campaign A ${stamp}`)
  await makeCanonical(`e2e campaign B ${stamp}`)

  // Create a campaign, then open the detail page for it specifically.
  const campaignPrompt = `e2e prompt ${stamp}`
  await page.goto('/admin/campaigns')
  await page.getByLabel('Prompt').fill(campaignPrompt)
  await page.getByRole('button', { name: 'Create campaign' }).click()
  await page.locator('li', { hasText: campaignPrompt }).getByRole('link', { name: 'Open' }).click()
  await expect(page.getByRole('heading', { name: campaignPrompt })).toBeVisible()

  // Add both questions by targeting the specific cards containing our question text.
  const textA = `e2e campaign A ${stamp}`
  const textB = `e2e campaign B ${stamp}`
  await page.locator('li', { hasText: textA }).getByRole('button', { name: 'Add' }).click()
  await page.locator('li', { hasText: textB }).getByRole('button', { name: 'Add' }).click()
  await page.getByRole('button', { name: 'Open for comparison' }).click()

  // Fetch a pair and judge it; a ranking with comparison counts appears.
  await page.getByRole('button', { name: 'Get next pair' }).click()
  await page.getByRole('button', { name: new RegExp(`e2e campaign [AB] ${stamp}`) }).first().click()
  await expect(page.getByText(/1 comparisons/).first()).toBeVisible()
})
