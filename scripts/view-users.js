#!/usr/bin/env node

/**
 * Simple script to view user signups from the database
 * Usage: node scripts/view-users.js [options]
 * Options:
 *   --recent N    Show only the N most recent users (default: 50)
 *   --all         Show all users
 *   --count       Show only the total count
 *   --plan PLAN   Filter by plan (free/pro)
 */

// Load environment variables
require('dotenv').config({ path: '.env.local' })

const { drizzle } = require('drizzle-orm/node-postgres')
const { Pool } = require('pg')
const { desc, eq, sql } = require('drizzle-orm')

// Import schema - we'll define it inline to avoid import issues
const { pgTable, text, timestamp, boolean, integer, json } = require('drizzle-orm/pg-core')

const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  plan: text('plan', { enum: ['free', 'pro'] }).notNull().default('pro'),
  stripeId: text('stripe_id').unique(),
  hadTrial: boolean('had_trial').default(false),
  goals: json('goals').default([]),
  frequency: integer('frequency'),
  hasXPremium: boolean('has_x_premium').default(false),
  postingWindowStart: integer('posting_window_start').default(8),
  postingWindowEnd: integer('posting_window_end').default(18),
})

async function main() {
  console.log('[VIEW-USERS] Starting user data query at', new Date().toISOString())
  
  const args = process.argv.slice(2)
  const showAll = args.includes('--all')
  const showCount = args.includes('--count')
  
  let limit = 50
  const recentIndex = args.indexOf('--recent')
  if (recentIndex !== -1 && args[recentIndex + 1]) {
    limit = parseInt(args[recentIndex + 1]) || 50
  }
  
  let planFilter = null
  const planIndex = args.indexOf('--plan')
  if (planIndex !== -1 && args[planIndex + 1]) {
    planFilter = args[planIndex + 1]
  }
  
  // Initialize database connection
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('[VIEW-USERS] ERROR: DATABASE_URL environment variable is not set')
    process.exit(1)
  }
  
  const shouldUseSsl = connectionString.includes('neon.tech') || connectionString.includes('sslmode=require')
  
  const pool = new Pool({
    connectionString,
    ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
    max: 1,
  })
  
  const db = drizzle(pool, { schema: { user } })
  
  try {
    if (showCount) {
      // Just show the count
      console.log('[VIEW-USERS] Fetching user count...')
      
      let countQuery = db.select({ count: sql`count(*)` }).from(user)
      if (planFilter) {
        countQuery = countQuery.where(eq(user.plan, planFilter))
      }
      
      const [result] = await countQuery
      const count = Number(result?.count || 0)
      
      console.log('\n📊 USER COUNT')
      console.log('═'.repeat(50))
      if (planFilter) {
        console.log(`Users with ${planFilter} plan: ${count.toLocaleString()}`)
      } else {
        console.log(`Total users: ${count.toLocaleString()}`)
      }
      
    } else {
      // Show user details
      console.log('[VIEW-USERS] Fetching user data...')
      
      let query = db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          plan: user.plan,
          createdAt: user.createdAt,
          emailVerified: user.emailVerified,
          hasXPremium: user.hasXPremium,
          stripeId: user.stripeId,
          hadTrial: user.hadTrial,
        })
        .from(user)
        .orderBy(desc(user.createdAt))
      
      if (planFilter) {
        query = query.where(eq(user.plan, planFilter))
      }
      
      if (!showAll) {
        query = query.limit(limit)
      }
      
      const users = await query
      
      console.log('\n👥 USER SIGNUPS')
      console.log('═'.repeat(80))
      console.log(`Showing ${showAll ? 'all' : `${limit} most recent`} users${planFilter ? ` with ${planFilter} plan` : ''}`)
      console.log(`Total found: ${users.length.toLocaleString()}`)
      console.log('─'.repeat(80))
      
      if (users.length === 0) {
        console.log('No users found.')
      } else {
        // Table header
        console.log(
          'DATE'.padEnd(12) + 
          'NAME'.padEnd(20) + 
          'EMAIL'.padEnd(30) + 
          'PLAN'.padEnd(6) + 
          'VERIFIED'.padEnd(10) + 
          'X PREMIUM'
        )
        console.log('─'.repeat(80))
        
        // User rows
        users.forEach(user => {
          const date = new Date(user.createdAt).toLocaleDateString('en-US', { 
            month: 'short', 
            day: '2-digit',
            year: '2-digit'
          })
          const name = (user.name || 'N/A').slice(0, 18)
          const email = user.email.slice(0, 28)
          const plan = user.plan || 'free'
          const verified = user.emailVerified ? 'YES' : 'NO'
          const xPremium = user.hasXPremium ? 'YES' : 'NO'
          
          console.log(
            date.padEnd(12) + 
            name.padEnd(20) + 
            email.padEnd(30) + 
            plan.padEnd(6) + 
            verified.padEnd(10) + 
            xPremium
          )
        })
      }
      
      // Summary stats
      console.log('\n📈 SUMMARY STATS')
      console.log('─'.repeat(30))
      
      const planStats = await db
        .select({ 
          plan: user.plan, 
          count: sql`count(*)` 
        })
        .from(user)
        .groupBy(user.plan)
      
      planStats.forEach(stat => {
        console.log(`${stat.plan}: ${Number(stat.count).toLocaleString()}`)
      })
      
      const verifiedCount = await db
        .select({ count: sql`count(*)` })
        .from(user)
        .where(eq(user.emailVerified, true))
      
      console.log(`Verified emails: ${Number(verifiedCount[0]?.count || 0).toLocaleString()}`)
      
      const xPremiumCount = await db
        .select({ count: sql`count(*)` })
        .from(user)
        .where(eq(user.hasXPremium, true))
      
      console.log(`X Premium users: ${Number(xPremiumCount[0]?.count || 0).toLocaleString()}`)
    }
    
  } catch (error) {
    console.error('[VIEW-USERS] Database error:', error)
    process.exit(1)
  } finally {
    await pool.end()
    console.log('\n[VIEW-USERS] Database connection closed at', new Date().toISOString())
  }
}

// Handle script execution
if (require.main === module) {
  main().catch(error => {
    console.error('[VIEW-USERS] Script error:', error)
    process.exit(1)
  })
}
