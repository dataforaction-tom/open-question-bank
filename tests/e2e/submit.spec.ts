import { test, expect } from '@playwright/test'

// Requires: docker compose up, model pulled, and `npm run db:seed` run once (Task 11).
// NOTE: this submits against whatever DB the dev server points to (the DEV db, not qb_test),
// because `reuseExistingServer` may reuse a manually-started server. The unique phrase avoids
// dedup collisions across runs; if this ever returns "candidates" unexpectedly, the dev
// `question` table has accumulated a near match — truncate it.
test('a new question can be submitted', async ({ page }) => {
  const unique = `e2e probe ${Date.now()} — what should councils prioritise for flood defence?`

  await page.goto('/submit')
  await page.getByLabel('Your question').fill(unique)
  await page.getByRole('button', { name: 'Submit' }).click()

  const created = page.getByText('your question was added', { exact: false })
  const chooseNew = page.getByRole('button', { name: 'None of these — mine is new' })

  await expect(created.or(chooseNew)).toBeVisible()
  if (await chooseNew.isVisible()) {
    await chooseNew.click()
  }
  await expect(page.getByRole('status')).toBeVisible()
})
