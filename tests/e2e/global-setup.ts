import 'dotenv/config'
import { execSync } from 'node:child_process'
import { Pool } from 'pg'

/**
 * Runs once before the e2e suite. Its whole job is isolation: the e2e dev server
 * (see playwright.config.ts) runs against a DEDICATED database — never the dev `qb`
 * database (so test runs can't pollute the data you develop against) and never
 * `qb_test` (which the vitest suite pins to a mock embedding model). The e2e dev
 * server uses real Ollama embeddings, so it needs its own DB with a real model
 * pinned. Here we create that DB if missing, migrate it, pin an active dataset
 * version, and clear any pipeline rows left by a previous run.
 */
const PIPELINE_TABLES = [
  'synthesis',
  'score',
  'comparison',
  'campaign_question',
  'campaign',
  'definedness_score',
  'refinement',
  'moderation_event',
  'cluster',
  'question',
]

export default async function globalSetup() {
  const e2eUrl = process.env.E2E_DATABASE_URL
  if (!e2eUrl) {
    throw new Error(
      'E2E_DATABASE_URL must be set to run the e2e suite — it keeps tests off the dev database.',
    )
  }

  await ensureDatabaseExists(e2eUrl)

  // Point the seed/migrate scripts at the e2e DB. db:migrate:test reads
  // TEST_DATABASE_URL; db:seed reads DATABASE_URL (via src/db/client). dotenv inside
  // those scripts won't clobber an already-set env var, so these win.
  const env = { ...process.env, DATABASE_URL: e2eUrl, TEST_DATABASE_URL: e2eUrl }
  execSync('npm run db:migrate:test', { stdio: 'inherit', env })
  execSync('npm run db:seed', { stdio: 'inherit', env })

  await truncatePipeline(e2eUrl)
}

// Create the e2e database and the pgvector extension if they don't yet exist.
// CREATE DATABASE can't run inside a transaction or with IF NOT EXISTS, so we check
// pg_database first, connecting to the server's default `postgres` database.
async function ensureDatabaseExists(e2eUrl: string) {
  const dbName = new URL(e2eUrl).pathname.replace(/^\//, '')
  const adminUrl = new URL(e2eUrl)
  adminUrl.pathname = '/postgres'

  const admin = new Pool({ connectionString: adminUrl.toString() })
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
    if (rowCount === 0) await admin.query(`CREATE DATABASE "${dbName}"`)
  } finally {
    await admin.end()
  }

  const target = new Pool({ connectionString: e2eUrl })
  try {
    await target.query('CREATE EXTENSION IF NOT EXISTS vector')
  } finally {
    await target.end()
  }
}

// Clear pipeline data from the previous run so the e2e DB doesn't grow unbounded.
// Keeps `workspace` and `dataset_version` (the active version the suite relies on).
async function truncatePipeline(e2eUrl: string) {
  const pool = new Pool({ connectionString: e2eUrl })
  try {
    await pool.query(`TRUNCATE TABLE ${PIPELINE_TABLES.join(', ')} RESTART IDENTITY CASCADE`)
  } finally {
    await pool.end()
  }
}
