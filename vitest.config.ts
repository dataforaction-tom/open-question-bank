import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup-integration.ts'],
    // Integration tests share a single `qb_test` database and reset it in beforeEach.
    // Run test files sequentially so their TRUNCATE/INSERT setup can't race across files.
    fileParallelism: false,
  },
})
