import { test, expect } from '@playwright/test'

// Admin (via API) creates a closed campaign, a comparing campaign, and a canonical
// question; an ANONYMOUS context discovers them via /campaigns and /questions.
test('the public can discover campaigns and questions without a direct link', async ({ page, browser }) => {
  const password = process.env.ADMIN_PASSWORD ?? 'admin'
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

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

  // A comparing campaign (open for judging).
  const ca = await makeCanonical(`discover A ${stamp}`)
  const cb = await makeCanonical(`discover B ${stamp}`)
  const comp = await page.request.post('/api/admin/campaigns', {
    data: { prompt: `discover comparing ${stamp}`, comparisonAxis: 'importance' },
  })
  const comparing = (await comp.json()).campaign
  await page.request.post(`/api/admin/campaigns/${comparing.id}/questions`, { data: { questionIds: [ca, cb] } })
  await page.request.post(`/api/admin/campaigns/${comparing.id}/open`)

  // A closed campaign (published agenda).
  const da = await makeCanonical(`discover C ${stamp}`)
  const dbq = await makeCanonical(`discover D ${stamp}`)
  const clo = await page.request.post('/api/admin/campaigns', {
    data: { prompt: `discover closed ${stamp}`, comparisonAxis: 'importance' },
  })
  const closed = (await clo.json()).campaign
  await page.request.post(`/api/admin/campaigns/${closed.id}/questions`, { data: { questionIds: [da, dbq] } })
  await page.request.post(`/api/admin/campaigns/${closed.id}/open`)
  await page.request.post(`/api/admin/campaigns/${closed.id}/comparisons`, {
    data: { questionAId: da, questionBId: dbq, winnerQuestionId: da },
  })
  await page.request.post(`/api/admin/campaigns/${closed.id}/close`)

  // Anonymous discovery — no admin cookie.
  const anon = await browser.newContext()
  const vp = await anon.newPage()

  await vp.goto('/campaigns')
  const publishedRow = vp.locator('li', { hasText: `discover closed ${stamp}` })
  await expect(publishedRow).toBeVisible()
  const judgingRow = vp.locator('li', { hasText: `discover comparing ${stamp}` })
  await expect(judgingRow).toBeVisible()

  // Follow the published agenda link through.
  await publishedRow.getByRole('link', { name: 'View agenda' }).click()
  await expect(vp.getByRole('heading', { name: `discover closed ${stamp}` })).toBeVisible()

  // The question bank lists a question from the closed campaign (ranked state).
  // Questions in the comparing campaign are in "under_comparison" state and not
  // shown in the public bank; only canonical and ranked questions appear.
  await vp.goto('/questions')
  await expect(vp.getByText(`discover C ${stamp}`)).toBeVisible()
  await anon.close()
})
