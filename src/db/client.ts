import 'dotenv/config'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is not set')
}

// Reuse a single pool across hot-reloads in dev.
const globalForDb = globalThis as unknown as { __qbPool?: Pool }
const pool = globalForDb.__qbPool ?? new Pool({ connectionString })
if (process.env.NODE_ENV !== 'production') globalForDb.__qbPool = pool

export const db = drizzle(pool, { schema })
export { pool }
