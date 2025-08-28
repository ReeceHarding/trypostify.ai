#!/usr/bin/env node

/**
 * Apply database migration to production
 * This script connects to the production database and applies pending migrations
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function applyMigration() {
  // Check if DATABASE_URL is available
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is required');
    console.log('Set it to your production database URL');
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔗 Connecting to production database...');
    await client.connect();
    
    // Check if columns already exist
    console.log('🔍 Checking if migration is needed...');
    
    const checkColumns = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'video_jobs' 
      AND column_name IN ('transcoding_job_id', 'transcoded_s3_key');
    `;
    
    const result = await client.query(checkColumns);
    
    if (result.rows.length === 2) {
      console.log('✅ Migration already applied - columns exist');
      return;
    }
    
    if (result.rows.length === 1) {
      console.log('⚠️  Partial migration detected - applying remaining columns');
    }
    
    console.log('🚀 Applying migration 0015_mute_karen_page.sql...');
    
    // Read and apply the migration
    const migrationSQL = fs.readFileSync(
      path.join(__dirname, '../migrations/0015_mute_karen_page.sql'), 
      'utf8'
    );
    
    // Split by statement breakpoint and execute each statement
    const statements = migrationSQL
      .split('--> statement-breakpoint')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt && !stmt.startsWith('--'));
    
    for (const statement of statements) {
      if (statement) {
        console.log('📝 Executing:', statement.substring(0, 50) + '...');
        try {
          await client.query(statement);
        } catch (error) {
          if (error.message.includes('already exists')) {
            console.log('ℹ️  Column already exists, skipping...');
          } else {
            throw error;
          }
        }
      }
    }
    
    console.log('✅ Migration applied successfully!');
    
    // Verify the migration worked
    const verifyResult = await client.query(checkColumns);
    if (verifyResult.rows.length === 2) {
      console.log('✅ Verification passed - both columns now exist');
    } else {
      console.log('⚠️  Verification failed - some columns may be missing');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔒 Database connection closed');
  }
}

// Run the migration
if (require.main === module) {
  applyMigration().catch(console.error);
}

module.exports = { applyMigration };
