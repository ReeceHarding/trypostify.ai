#!/usr/bin/env node

/**
 * Real User Statistics Script
 * 
 * This script analyzes the database to show post statistics by actual users,
 * excluding test accounts and internal usage.
 */

import { drizzle } from 'drizzle-orm/node-postgres'
import pkg from 'pg'
const { Pool } = pkg
import { sql } from 'drizzle-orm'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config({ path: '.env.local' })

async function main() {
  console.log('🚀 REAL USER STATISTICS ANALYZER')
  console.log('═'.repeat(60))
  console.log('[REAL-STATS] Starting analysis at', new Date().toISOString())
  console.log('[REAL-STATS] Excluding Reece Harding test accounts...')
  
  const args = process.argv.slice(2)
  const showDetails = args.includes('--details')
  const limitCount = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) || 20 : null
  const planFilter = args.includes('--plan') ? args[args.indexOf('--plan') + 1] : null
  
  console.log('[REAL-STATS] Configuration:')
  console.log('  - Show details:', showDetails)
  console.log('  - Limit results:', limitCount || 'No limit')
  console.log('  - Plan filter:', planFilter || 'All plans')
  console.log()
  
  // Initialize database connection
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('[REAL-STATS] ERROR: DATABASE_URL environment variable is not set')
    process.exit(1)
  }
  
  console.log('[REAL-STATS] Connecting to database...')
  const shouldUseSsl = connectionString.includes('neon.tech') || connectionString.includes('sslmode=require')
  
  const pool = new Pool({
    connectionString,
    ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
    max: 1,
  })
  
  const db = drizzle(pool)
  
  try {
    console.log('[REAL-STATS] Executing database queries...')
    
    // Get comprehensive user post statistics, excluding Reece Harding accounts
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
      WHERE u.name != 'Reece Harding'
      ${planFilter ? `AND u.plan = '${planFilter}'` : ''}
      GROUP BY u.id, u.name, u.email, u.plan, u.created_at, u.email_verified, u.has_x_premium
      ORDER BY total_posts DESC
      ${limitCount ? `LIMIT ${limitCount}` : ''}
    `
    
    console.log('[REAL-STATS] Running real user analysis query...')
    const results = await db.execute(sql.raw(query))
    const userStats = results.rows
    
    console.log(`[REAL-STATS] Query completed. Found ${userStats.length} real users.`)
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
      activeUsers: userStats.filter(user => parseInt(user.total_posts || 0) > 0).length,
    }
    
    // Display summary
    console.log('📊 REAL USER SUMMARY STATISTICS')
    console.log('═'.repeat(60))
    console.log(`Total Real Users: ${totals.totalUsers.toLocaleString()}`)
    console.log(`Active Users (posted): ${totals.activeUsers.toLocaleString()} (${totals.totalUsers > 0 ? Math.round(totals.activeUsers / totals.totalUsers * 100) : 0}%)`)
    console.log(`Inactive Users: ${(totals.totalUsers - totals.activeUsers).toLocaleString()} (${totals.totalUsers > 0 ? Math.round((totals.totalUsers - totals.activeUsers) / totals.totalUsers * 100) : 0}%)`)
    console.log()
    console.log(`Total Posts by Real Users: ${totals.totalPosts.toLocaleString()}`)
    console.log(`  ├─ Published: ${totals.publishedPosts.toLocaleString()} (${totals.totalPosts > 0 ? Math.round(totals.publishedPosts / totals.totalPosts * 100) : 0}%)`)
    console.log(`  ├─ Scheduled: ${totals.scheduledPosts.toLocaleString()} (${totals.totalPosts > 0 ? Math.round(totals.scheduledPosts / totals.totalPosts * 100) : 0}%)`)
    console.log(`  ├─ Queued: ${totals.queuedPosts.toLocaleString()} (${totals.totalPosts > 0 ? Math.round(totals.queuedPosts / totals.totalPosts * 100) : 0}%)`)
    console.log(`  └─ Drafts: ${totals.draftPosts.toLocaleString()} (${totals.totalPosts > 0 ? Math.round(totals.draftPosts / totals.totalPosts * 100) : 0}%)`)
    console.log(`Total Threads: ${totals.uniqueThreads.toLocaleString()}`)
    console.log(`Average Posts per User: ${totals.totalUsers > 0 ? (totals.totalPosts / totals.totalUsers).toFixed(1) : 0}`)
    console.log(`Average Posts per Active User: ${totals.activeUsers > 0 ? (totals.totalPosts / totals.activeUsers).toFixed(1) : 0}`)
    console.log()
    
    // Display user statistics
    console.log('👥 REAL USER POST STATISTICS')
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
                  'Status')
    }
    console.log('─'.repeat(120))
    
    if (userStats.length === 0) {
      console.log('No real users found with posts.')
      console.log()
      console.log('This means all posts in the database are from test accounts.')
      console.log('Consider this a clean slate for real user adoption!')
    } else {
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
        const status = total > 0 ? 'Active' : 'Inactive'
        
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
            status
          )
        }
      })
    }
    
    console.log('─'.repeat(120))
    console.log(`Showing ${userStats.length} real users ${limitCount ? `(limited to ${limitCount})` : ''}`)
    
    // Show plan breakdown for real users only
    console.log()
    console.log('📈 REAL USER PLAN BREAKDOWN')
    console.log('═'.repeat(50))
    
    const planQuery = `
      SELECT 
        u.plan,
        COUNT(u.id) as user_count,
        COUNT(t.id) as total_posts,
        COUNT(CASE WHEN t.is_published = true THEN 1 END) as published_posts,
        COUNT(CASE WHEN t.id IS NOT NULL THEN u.id END) as active_users
      FROM "user" u
      LEFT JOIN tweets t ON u.id = t.user_id
      WHERE u.name != 'Reece Harding'
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
    
    // Show engagement insights
    console.log()
    console.log('💡 USER ENGAGEMENT INSIGHTS')
    console.log('═'.repeat(50))
    
    if (totals.totalPosts === 0) {
      console.log('🔴 CRITICAL: Zero posts from real users')
      console.log('   - All activity is from test accounts')
      console.log('   - Need to focus on user onboarding and activation')
      console.log('   - Consider user engagement campaigns')
    } else if (totals.activeUsers / totals.totalUsers < 0.1) {
      console.log('🟡 LOW ENGAGEMENT: Less than 10% of users have posted')
      console.log(`   - Only ${totals.activeUsers} out of ${totals.totalUsers} users are active`)
      console.log('   - Focus on onboarding and first-post experience')
    } else if (totals.activeUsers / totals.totalUsers < 0.3) {
      console.log('🟠 MODERATE ENGAGEMENT: 10-30% of users are active')
      console.log(`   - ${totals.activeUsers} out of ${totals.totalUsers} users are posting`)
      console.log('   - Good foundation, focus on retention and frequency')
    } else {
      console.log('🟢 GOOD ENGAGEMENT: 30%+ of users are active')
      console.log(`   - ${totals.activeUsers} out of ${totals.totalUsers} users are posting`)
      console.log('   - Focus on scaling and advanced features')
    }
    
    const avgPostsPerActiveUser = totals.activeUsers > 0 ? totals.totalPosts / totals.activeUsers : 0
    if (avgPostsPerActiveUser < 2) {
      console.log('📝 Most active users are just getting started (< 2 posts avg)')
    } else if (avgPostsPerActiveUser < 5) {
      console.log('📝 Active users are moderately engaged (2-5 posts avg)')
    } else {
      console.log('📝 Active users are highly engaged (5+ posts avg)')
    }
    
    console.log()
    console.log('[REAL-STATS] Analysis completed successfully at', new Date().toISOString())
    
  } catch (error) {
    console.error('[REAL-STATS] Error during analysis:', error)
    console.error('[REAL-STATS] Error stack:', error.stack)
    process.exit(1)
  } finally {
    console.log('[REAL-STATS] Closing database connection...')
    await pool.end()
    console.log('[REAL-STATS] Database connection closed.')
  }
}

// Handle script execution
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('[REAL-STATS] Unhandled error:', error)
    process.exit(1)
  })
}

export default main
