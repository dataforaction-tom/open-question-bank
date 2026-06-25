import { test, expect } from '@playwright/test'

// The switcher is rendered app-wide from PageShell's header. These checks need no
// DB state — they exercise the client-side theme machinery on the public home page.

test('defaults to a Warm Civic skin (Auto) on first visit', async ({ page }) => {
  await page.goto('/')
  // No stored preference → Auto resolves to a Warm Civic light/dark theme.
  await expect(page.locator('html')).toHaveAttribute('data-theme', /warm-civic/)
})

test('picking a theme applies it and persists across reload', async ({ page }) => {
  await page.goto('/')

  // Open the header switcher and choose Climate Barometer.
  await page.getByRole('button', { name: /^(Auto|Warm Civic|Climate Barometer)/ }).click()
  await page.getByRole('menuitemradio', { name: 'Climate Barometer' }).click()

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'climate-barometer')
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('climate-barometer')

  // The no-flash script must restore it on the next load.
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'climate-barometer')
})
