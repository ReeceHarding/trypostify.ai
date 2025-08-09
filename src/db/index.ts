// Switch to Node Postgres driver to support both local Postgres and Neon in production.
// The previous neon-http setup attempted to use fetch against a local database, which fails.
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  // Fail fast with a clear error to avoid silent misconfigurations.
  throw new Error('[DB] DATABASE_URL is not set')
}

// Enable SSL automatically for Neon or when sslmode=require is present.
// Local connections (e.g., postgresql://user@localhost:5432/db) will not use SSL.
const shouldUseSsl =
  connectionString.includes('neon.tech') ||
  connectionString.includes('sslmode=require')

const pool = new Pool({
  connectionString,
  ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
})

export const db = drizzle(pool, { schema })
