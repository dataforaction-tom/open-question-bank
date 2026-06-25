import 'dotenv/config'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

// Keeps the integration-test database (`qb_test`) in sync with the latest migrations.
// Run automatically via the `pretest` hook so a fresh schema change never silently
// fails the suite against a stale test DB. Targets TEST_DATABASE_URL, never the dev DB.
async function main() {
  const connectionString = process.env.TEST_DATABASE_URL
  if (!connectionString) {
    // No test DB configured (e.g. CI unit-only runs) — nothing to migrate.
    console.log('TEST_DATABASE_URL is not set; skipping test DB migration.')
    return
  }

  const pool = new Pool({ connectionString })
  try {
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' })
    console.log('Test DB migrations applied successfully.')
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
