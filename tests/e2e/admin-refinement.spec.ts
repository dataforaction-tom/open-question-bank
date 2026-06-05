import { test, expect } from '@playwright/test'

// Requires the docker stack up, the dev db seeded, and ADMIN_PASSWORD/ADMIN_SESSION_SECRET in .env.
// The dev server runs with REASONING_PROVIDER=mock (see playwright.config.ts), so no live model is needed.
test('admin refines a clustered question (suggest → edit → accept)', async ({ page, request }) => {
  const password = process.env.ADMIN_PASSWORD ?? 'admin'
  const unique = `e2e refine ${Date.now()} — how do we fix education?`

  // Create a submission, then approve it through the API to reach the `clustered` state.
  const created = await request.post('/api/questions', {
    data: { rawText: unique, visibility: 'public', decision: { type: 'new' } },
  })
  expect(created.ok()).toBeTruthy()
  // Public submit returns { status, question: { id, canonicalText } } (src/app/api/questions/route.ts).
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

  // Open the refinement page; our question should be listed.
  await page.goto('/admin/refinement')
  const row = page.locator('li', { hasText: unique })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Suggest refinement' }).click()

  // The mock suggestion appears in the editable textarea; edit it, then accept.
  const textarea = page.getByLabel('Suggested (editable):')
  await expect(textarea).toHaveValue(/refined/)
  await textarea.fill('human-corrected question')
  await page.getByRole('button', { name: 'Save edit' }).click()
  await expect(page.getByRole('status')).toContainText(/recorded: edit/i)

  // The refinement was recorded and canonical_text updated.
  const history = await page.request.get(`/api/admin/questions/${id}/refinements`)
  const { refinements } = await history.json()
  expect(refinements).toHaveLength(1)
  expect(refinements[0].after).toBe('human-corrected question')
  expect(refinements[0].llmSuggestedText).toMatch(/refined/)
})
