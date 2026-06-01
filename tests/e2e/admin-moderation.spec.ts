import { test, expect } from '@playwright/test'

// Playwright runs its own dev server on port 3100 (see playwright.config.ts). Requires the
// docker stack (Postgres/Ollama) up, the dev db seeded, and ADMIN_PASSWORD/ADMIN_SESSION_SECRET in .env.
test('admin logs in and approves a pending question', async ({ page, request }) => {
  const password = process.env.ADMIN_PASSWORD ?? 'admin'
  const unique = `e2e moderation ${Date.now()} — what should councils prioritise for coastal erosion?`

  // Create a pending submission via the public API (force "new" so it lands as submitted).
  const created = await request.post('/api/questions', {
    data: { rawText: unique, visibility: 'public', decision: { type: 'new' } },
  })
  expect(created.ok()).toBeTruthy()

  // Unauthenticated moderation page redirects to login.
  await page.goto('/admin/moderation')
  await expect(page).toHaveURL(/\/admin\/login/)

  // Log in.
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /log in/i }).click()
  await expect(page).toHaveURL(/\/admin\/moderation/)

  // Our question is in the queue; approve it.
  const row = page.locator('li', { hasText: unique })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Approve' }).click()

  // Cluster confirmation appears.
  await expect(page.getByRole('status')).toContainText(/cluster/i)
})
