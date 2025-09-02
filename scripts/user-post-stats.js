#!/usr/bin/env node

/**
 * User Post Statistics Script
 * 
 * This script analyzes the database to show comprehensive post statistics by user.
 * It counts total posts, published posts, scheduled posts, and queued posts for each user.
 */

import { drizzle } from 'drizzle-orm/node-postgres'
import pkg from 'pg'
const { Pool } = pkg
import { sql, eq, and, desc, count } from 'drizzle-orm'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config({ path: '.env.local' })

// Import database schemas
const user = {
  id: 'id',
  name: 'name', 
  email: 'email',
  plan: 'plan',
  createdAt: 'created_at',
  emailVerified: 'email_verified',
  hasXPremium: 'has_x_premium',
  stripeId: 'stripe_id',
  hadTrial: 'had_trial',
}

const tweets = {
  id: 'id',
  content: 'content',
  userId: 'user_id',
  accountId: 'account_id',
  isQueued: 'is_queued',
  isScheduled: 'is_scheduled',
  isPublished: 'is_published',
  threadId: 'thread_id',
  position: 'position',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
}

async function main() {
  console.log('🔍 USER POST STATISTICS ANALYZER')
  console.log('═'.repeat(60))
  console.log('[STATS] Starting analysis at', new Date().toISOString())
  
  const args = process.argv.slice(2)
  const showDetails = args.includes('--details')
  const limitCount = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) || 20 : null
  const sortBy = args.includes('--sort-by') ? args[args.indexOf('--sort-by') + 1] || 'total' : 'total'
  const planFilter = args.includes('--plan') ? args[args.indexOf('--plan') + 1] : null
  
  console.log('[STATS] Configuration:')
  console.log('  - Show details:', showDetails)
  console.log('  - Limit results:', limitCount || 'No limit')
  console.log('  - Sort by:', sortBy)
  console.log('  - Plan filter:', planFilter || 'All plans')
  console.log()
  
  // Initialize database connection
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('[STATS] ERROR: DATABASE_URL environment variable is not set')
    process.exit(1)
  }
  
  console.log('[STATS] Connecting to database...')
  const shouldUseSsl = connectionString.includes('neon.tech') || connectionString.includes('sslmode=require')
  console.log('[STATS] SSL mode:', shouldUseSsl ? 'enabled' : 'disabled')
  
  const pool = new Pool({
    connectionString,
    ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
    max: 1,
  })
  
  const db = drizzle(pool)
  
  try {
    console.log('[STATS] Executing database queries...')
    
    // Get comprehensive user post statistics
    const query = `
      SELECT 
        u.id as user_id,
        u.name as user_name,
        u.email as user_email,
        u.plan as user_plan,
        u.created_at as user_created_at,
        u.email_verified as email_verified,
        u.has_x_premium as has_x_premium,
        COUNT(t.id) as total_posts,
        COUNT(CASE WHEN t.is_published = true THEN 1 END) as published_posts,
        COUNT(CASE WHEN t.is_scheduled = true AND t.is_published = false THEN 1 END) as scheduled_posts,
        COUNT(CASE WHEN t.is_queued = true AND t.is_published = false THEN 1 END) as queued_posts,
        COUNT(CASE WHEN t.is_published = false AND t.is_scheduled = false AND t.is_queued = false THEN 1 END) as draft_posts,
        COUNT(DISTINCT t.thread_id) as unique_threads,
        MIN(t.created_at) as first_post_date,
        MAX(t.created_at) as last_post_date
      FROM "user" u
      LEFT JOIN tweets t ON u.id = t.user_id
      ${planFilter ? `WHERE u.plan = '${planFilter}'` : ''}
      GROUP BY u.id, u.name, u.email, u.plan, u.created_at, u.email_verified, u.has_x_premium
      ORDER BY 
        ${sortBy === 'published' ? 'published_posts' : 
          sortBy === 'scheduled' ? 'scheduled_posts' :
          sortBy === 'queued' ? 'queued_posts' :
          sortBy === 'threads' ? 'unique_threads' :
          sortBy === 'name' ? 'u.name' :
          sortBy === 'email' ? 'u.email' :
          sortBy === 'created' ? 'u.created_at' :
          'total_posts'} DESC
      ${limitCount ? `LIMIT ${limitCount}` : ''}
    `
    
    console.log('[STATS] Running comprehensive user post analysis query...')
    const results = await db.execute(sql.raw(query))
    const userStats = results.rows
    
    console.log(`[STATS] Query completed. Found ${userStats.length} users.`)
    console.log()
    
    // Calculate totals
    const totals = {
      totalUsers: userStats.length,
      totalPosts: userStats.reduce((sum, user) => sum + parseInt(user.total_posts || 0), 0),
      publishedPosts: userStats.reduce((sum, user) => sum + parseInt(user.published_posts || 0), 0),
      scheduledPosts: userStats.reduce((sum, user) => sum + parseInt(user.scheduled_posts || 0), 0),
      queuedPosts: userStats.reduce((sum, user) => sum + parseInt(user.queued_posts || 0), 0),
      draftPosts: userStats.reduce((sum, user) => sum + parseInt(user.draft_posts || 0), 0),
      uniqueThreads: userStats.reduce((sum, user) => sum + parseInt(user.unique_threads || 0), 0),
    }
    
    // Display summary
    console.log('📊 SUMMARY STATISTICS')
    console.log('═'.repeat(60))
    console.log(`Total Users: ${totals.totalUsers.toLocaleString()}`)
    console.log(`Total Posts: ${totals.totalPosts.toLocaleString()}`)
    console.log(`  ├─ Published: ${totals.publishedPosts.toLocaleString()} (${totals.totalPosts > 0 ? Math.round(totals.publishedPosts / totals.totalPosts * 100) : 0}%)`)
    console.log(`  ├─ Scheduled: ${totals.scheduledPosts.toLocaleString()} (${totals.totalPosts > 0 ? Math.round(totals.scheduledPosts / totals.totalPosts * 100) : 0}%)`)
    console.log(`  ├─ Queued: ${totals.queuedPosts.toLocaleString()} (${totals.totalPosts > 0 ? Math.round(totals.queuedPosts / totals.totalPosts * 100) : 0}%)`)
    console.log(`  └─ Drafts: ${totals.draftPosts.toLocaleString()} (${totals.totalPosts > 0 ? Math.round(totals.draftPosts / totals.totalPosts * 100) : 0}%)`)
    console.log(`Total Threads: ${totals.uniqueThreads.toLocaleString()}`)
    console.log(`Average Posts per User: ${totals.totalUsers > 0 ? (totals.totalPosts / totals.totalUsers).toFixed(1) : 0}`)
    console.log()
    
    // Display user statistics
    console.log('👥 USER POST STATISTICS')
    console.log('═'.repeat(120))
    
    if (showDetails) {
      console.log('ID'.padEnd(36) + ' | ' + 
                  'Name'.padEnd(20) + ' | ' + 
                  'Email'.padEnd(25) + ' | ' + 
                  'Plan'.padEnd(6) + ' | ' + 
                  'Total'.padEnd(6) + ' | ' + 
                  'Pub'.padEnd(4) + ' | ' + 
                  'Sch'.padEnd(4) + ' | ' + 
                  'Que'.padEnd(4) + ' | ' + 
                  'Draft'.padEnd(5) + ' | ' + 
                  'Threads'.padEnd(7) + ' | ' + 
                  'X Premium')
    } else {
      console.log('Name'.padEnd(25) + ' | ' + 
                  'Email'.padEnd(30) + ' | ' + 
                  'Plan'.padEnd(6) + ' | ' + 
                  'Total Posts'.padEnd(11) + ' | ' + 
                  'Published'.padEnd(9) + ' | ' + 
                  'Scheduled'.padEnd(9) + ' | ' + 
                  'Queued'.padEnd(6) + ' | ' + 
                  'Threads')
    }
    console.log('─'.repeat(120))
    
    userStats.forEach((user, index) => {
      const name = (user.user_name || 'Unknown').substring(0, showDetails ? 20 : 25)
      const email = (user.user_email || 'No email').substring(0, showDetails ? 25 : 30)
      const plan = user.user_plan || 'free'
      const total = parseInt(user.total_posts || 0)
      const published = parseInt(user.published_posts || 0)
      const scheduled = parseInt(user.scheduled_posts || 0)
      const queued = parseInt(user.queued_posts || 0)
      const drafts = parseInt(user.draft_posts || 0)
      const threads = parseInt(user.unique_threads || 0)
      const xPremium = user.has_x_premium ? 'Yes' : 'No'
      
      if (showDetails) {
        console.log(
          (user.user_id || '').substring(0, 36).padEnd(36) + ' | ' +
          name.padEnd(20) + ' | ' +
          email.padEnd(25) + ' | ' +
          plan.padEnd(6) + ' | ' +
          total.toString().padEnd(6) + ' | ' +
          published.toString().padEnd(4) + ' | ' +
          scheduled.toString().padEnd(4) + ' | ' +
          queued.toString().padEnd(4) + ' | ' +
          drafts.toString().padEnd(5) + ' | ' +
          threads.toString().padEnd(7) + ' | ' +
          xPremium
        )
      } else {
        console.log(
          name.padEnd(25) + ' | ' +
          email.padEnd(30) + ' | ' +
          plan.padEnd(6) + ' | ' +
          total.toString().padEnd(11) + ' | ' +
          published.toString().padEnd(9) + ' | ' +
          scheduled.toString().padEnd(9) + ' | ' +
          queued.toString().padEnd(6) + ' | ' +
          threads.toString()
        )
      }
    })
    
    if (userStats.length === 0) {
      console.log('No users found with the specified criteria.')
    }
    
    console.log('─'.repeat(120))
    console.log(`Showing ${userStats.length} users ${limitCount ? `(limited to ${limitCount})` : ''}`)
    
    // Show plan breakdown
    console.log()
    console.log('📈 PLAN BREAKDOWN')
    console.log('═'.repeat(40))
    
    const planQuery = `
      SELECT 
        u.plan,
        COUNT(u.id) as user_count,
        COUNT(t.id) as total_posts,
        COUNT(CASE WHEN t.is_published = true THEN 1 END) as published_posts
      FROM "user" u
      LEFT JOIN tweets t ON u.id = t.user_id
      GROUP BY u.plan
      ORDER BY user_count DESC
    `
    
    const planResults = await db.execute(sql.raw(planQuery))
    const planStats = planResults.rows
    
    planStats.forEach(plan => {
      const planName = plan.plan || 'Unknown'
      const userCount = parseInt(plan.user_count || 0)
      const totalPosts = parseInt(plan.total_posts || 0)
      const publishedPosts = parseInt(plan.published_posts || 0)
      const avgPosts = userCount > 0 ? (totalPosts / userCount).toFixed(1) : 0
      
      console.log(`${planName.toUpperCase().padEnd(8)} | Users: ${userCount.toString().padStart(4)} | Posts: ${totalPosts.toString().padStart(6)} | Published: ${publishedPosts.toString().padStart(6)} | Avg: ${avgPosts}`)
    })
    
    console.log()
    console.log('[STATS] Analysis completed successfully at', new Date().toISOString())
    
  } catch (error) {
    console.error('[STATS] Error during analysis:', error)
    console.error('[STATS] Error stack:', error.stack)
    process.exit(1)
  } finally {
    console.log('[STATS] Closing database connection...')
    await pool.end()
    console.log('[STATS] Database connection closed.')
  }
}

// Handle script execution
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('[STATS] Unhandled error:', error)
    process.exit(1)
  })
}

export default main
