import { test, expect } from '@playwright/test'

// Admin (via API) promotes a few canonical questions; an ANONYMOUS visitor searches the bank,
// opens a question, and sees the "similar" surface — none of which exposes submitter identity.
test('the public can search the bank, open a question, and see similar', async ({ page, browser }) => {
  const password = process.env.ADMIN_PASSWORD ?? 'admin'
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const term = `zphrase${stamp.replace(/[^a-z0-9]/gi, '')}`

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

  await makeCanonical(`How can our town improve ${term} for residents?`)
  await makeCanonical(`What would better ${term} look like locally?`)

  // Anonymous discovery — no admin cookie.
  const anon = await browser.newContext()
  const vp = await anon.newPage()

  await vp.goto('/browse')
  await vp.getByLabel('Search').fill(term)
  await vp.getByRole('button', { name: 'Search', exact: true }).click()

  const firstResult = vp.locator('li', { hasText: term }).first()
  await expect(firstResult).toBeVisible()

  // The "find similar" affordance expands inline.
  await firstResult.getByRole('button', { name: 'Find similar' }).click()
  await expect(firstResult.getByRole('button', { name: 'Hide similar' })).toBeVisible()

  // Open the question detail and confirm the similar section renders.
  await firstResult.getByRole('link').first().click()
  await expect(vp).toHaveURL(/\/questions\/[0-9a-f-]+/)
  await expect(vp.getByText('Similar questions')).toBeVisible()

  await anon.close()
})
