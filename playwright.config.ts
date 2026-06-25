import 'dotenv/config'
import { defineConfig } from '@playwright/test'

const PORT = 3100

// The e2e dev server runs against a DEDICATED database (qb_e2e), never the dev `qb`
// database (so test runs can't pollute the data you develop against) and never
// qb_test (which the vitest suite pins to a mock embedder). global-setup.ts creates
// and readies that DB before the suite starts.
const e2eDatabaseUrl = process.env.E2E_DATABASE_URL
if (!e2eDatabaseUrl) {
  throw new Error('E2E_DATABASE_URL must be set to run the e2e suite (keeps tests off the dev DB).')
}

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `DATABASE_URL='${e2eDatabaseUrl}' PORT=${PORT} REASONING_PROVIDER=mock npm run dev`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
