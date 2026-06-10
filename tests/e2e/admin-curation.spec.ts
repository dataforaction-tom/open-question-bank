import { test, expect } from '@playwright/test'

// Requires the docker stack up, the dev db seeded, and ADMIN_PASSWORD/ADMIN_SESSION_SECRET in .env.
// The dev server runs with REASONING_PROVIDER=mock (see playwright.config.ts), so no live model is needed.
test('admin scores then promotes a clustered question', async ({ page, request }) => {
  const password = process.env.ADMIN_PASSWORD ?? 'admin'
  const unique = `e2e curation ${Date.now()} — how do we fix education?`

  // Create a submission, then approve it through the API to reach the `clustered` state.
  const created = await request.post('/api/questions', {
    data: { rawText: unique, visibility: 'public', decision: { type: 'new' } },
  })
  expect(created.ok()).toBeTruthy()
  const {
    question: { id },
  } = await created.json()

  // Log in (sets the admin session cookie shared by page + request).
  await page.goto('/admin/login')
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /log in/i }).click()
  await expect(page).toHaveURL(/\/admin\/moderation/)

  const approve = await page.request.post(`/api/admin/questions/${id}/approve`)
  expect(approve.ok()).toBeTruthy()

  // Open the curation page; our question should be listed.
  await page.goto('/admin/curation')
  const row = page.locator('li', { hasText: unique })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Curate' }).click()

  // Score: the deterministic mock breakdown renders (all five criteria at 4/5, average 4.0).
  await page.getByRole('button', { name: 'Score definedness' }).click()
  await expect(page.getByText('Average: 4.0')).toBeVisible()
  await expect(page.getByText('specific: 4 / 5 — mock specific rationale')).toBeVisible()
  await expect(page.getByText('single-barrelled: 4 / 5 — mock single-barrelled rationale')).toBeVisible()

  // Promote: advisory scores don't gate it; the question leaves the clustered list.
  await page.getByRole('button', { name: 'Promote to canonical' }).click()
  await expect(page.getByRole('status')).toContainText(/promoted to canonical/i)
  await expect(page.locator('li', { hasText: unique })).toHaveCount(0)

  // State really is canonical now: a second promote is rejected, and the five score rows persist.
  const again = await page.request.post(`/api/admin/questions/${id}/promote`)
  expect(again.status()).toBe(409)
  const scores = await page.request.get(`/api/admin/questions/${id}/scores`)
  const { history } = await scores.json()
  expect(history).toHaveLength(5)
})
