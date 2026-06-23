import { test, expect } from '@playwright/test'

// Admin runs a campaign to closed, proposes syntheses (mock provider) and endorses
// one; an anonymous context sees the endorsed synthesis + lineage on the agenda page.
test('admin synthesises a closed campaign; the public sees it', async ({ page, browser }) => {
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
  const a = await makeCanonical(`synth option A ${stamp}`)
  const b = await makeCanonical(`synth option B ${stamp}`)

  const created = await page.request.post('/api/admin/campaigns', {
    data: { prompt: `synth campaign ${stamp}`, comparisonAxis: 'importance' },
  })
  const { campaign } = await created.json()
  await page.request.post(`/api/admin/campaigns/${campaign.id}/questions`, { data: { questionIds: [a, b] } })
  await page.request.post(`/api/admin/campaigns/${campaign.id}/open`)
  await page.request.post(`/api/admin/campaigns/${campaign.id}/comparisons`, {
    data: { questionAId: a, questionBId: b, winnerQuestionId: a },
  })
  await page.request.post(`/api/admin/campaigns/${campaign.id}/close`)

  // Admin: open the detail page, propose, endorse.
  await page.goto(`/admin/campaigns/${campaign.id}`)
  await page.getByRole('button', { name: 'Propose syntheses' }).click()
  await expect(page.getByText('Synthesis of the top questions')).toBeVisible()
  await page.getByRole('button', { name: 'Endorse' }).first().click()
  await expect(page.getByText(/endorsed/)).toBeVisible()

  // Anonymous viewer sees the endorsed synthesis + its lineage on the agenda.
  const anon = await browser.newContext()
  const vp = await anon.newPage()
  await vp.goto(`/campaigns/${campaign.id}`)
  await expect(vp.getByText('Synthesised questions')).toBeVisible()
  await expect(vp.getByText('Synthesis of the top questions')).toBeVisible()
  await expect(vp.getByText(`— synth option A ${stamp}`)).toBeVisible()
  await anon.close()
})
