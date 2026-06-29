import { test, expect } from '@playwright/test'

// Requires: docker compose up and the embedding model pulled. The e2e dev server runs
// against the TEST database (see playwright.config.ts + global-setup.ts), never the dev
// `qb` DB, so this submission can't pollute your dev data. The unique phrase still avoids
// dedup collisions across runs within the test DB.
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
