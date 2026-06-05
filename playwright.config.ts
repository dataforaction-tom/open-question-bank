import 'dotenv/config'
import { defineConfig } from '@playwright/test'

const PORT = 3100

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `PORT=${PORT} REASONING_PROVIDER=mock npm run dev`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
