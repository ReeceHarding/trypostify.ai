// Switch to Node Postgres driver to support both local Postgres and Neon in production.
// The previous neon-http setup attempted to use fetch against a local database, which fails.
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

// Lazy initialization to prevent build-time errors when DATABASE_URL is not available
let _db: ReturnType<typeof drizzle> | null = null
let _pool: Pool | null = null

function initializeDatabase() {
  if (_db) return _db

  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    // Fail fast with a clear error to avoid silent misconfigurations.
    throw new Error('[DB] DATABASE_URL is not set')
  }

  console.log('[DB] Initializing database connection...', new Date().toISOString())

  // Enable SSL automatically for Neon or when sslmode=require is present.
  // Local connections (e.g., postgresql://user@localhost:5432/db) will not use SSL.
  const shouldUseSsl =
    connectionString.includes('neon.tech') ||
    connectionString.includes('sslmode=require')

  console.log('[DB] SSL mode:', shouldUseSsl ? 'enabled' : 'disabled')

  _pool = new Pool({
    connectionString,
    ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
    // In serverless environments, keep the pool small to avoid exhausting DB connections on cold starts
    max: 3,
    min: 1,
    // Recycle idle connections sooner to reduce chance of provider-side termination
    idleTimeoutMillis: 10000,
    // Be more tolerant on initial connects
    connectionTimeoutMillis: 10000,
    // Keep connections alive
    keepAlive: true,
    keepAliveInitialDelayMillis: 0,
    // Periodically recycle connections after N uses to avoid long-lived stale sockets
    // @ts-expect-error supported by node-postgres at runtime
    maxUses: 7500,
  })

  // Proactively handle unexpected pool errors by resetting the pool so the next query re-initializes
  _pool.on('error', (err) => {
    console.error('[DB] Pool error, resetting pool at', new Date().toISOString(), err)
    try {
      _pool?.end().catch(() => {})
    } catch {}
    _pool = null
    _db = null
  })

  _db = drizzle(_pool, { schema })
  
  console.log('[DB] Database connection initialized successfully')
  return _db
}

// Export a getter that initializes the database on first access
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(target, prop) {
    const database = initializeDatabase()
    return database[prop as keyof typeof database]
  }
})
