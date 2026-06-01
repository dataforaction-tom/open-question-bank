import 'dotenv/config'

// Applied to ALL test files. It only redirects DATABASE_URL → TEST_DATABASE_URL, which is a
// no-op for unit tests (they mock fetch and never open the DB) and the safety net for
// integration tests, which must never touch the dev database. src/db/client.ts reads
// DATABASE_URL at import time, so this must run before any DB module is imported — setupFiles do.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
}
