import { redis } from '@/lib/redis'
import { db } from '@/db'
import { account as accountSchema, user as userSchema } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { customAlphabet } from 'nanoid'
import { Account } from '../settings-router'

const nanoid = customAlphabet(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  32,
)

export const getAccount = async ({ email }: { email: string }) => {
  console.log(`[GET_ACCOUNT] Fetching account for email: ${email}`, new Date().toISOString())
  
  // Get account from Redis (contains Twitter profile data)
  const redisAccount = await redis.json.get<Account>(`active-account:${email}`)
  
  if (!redisAccount) {
    console.log(`[GET_ACCOUNT] No active account found in Redis for email: ${email}`)
    return null
  }
  
  console.log(`[GET_ACCOUNT] Found Redis account: ${redisAccount.id} (${redisAccount.username})`)
  
  // Check if this account exists in the database
  const [dbAccount] = await db
    .select()
    .from(accountSchema)
    .where(eq(accountSchema.id, redisAccount.id))
    .limit(1)
  
  if (!dbAccount) {
    console.log(`[GET_ACCOUNT] Account ${redisAccount.id} exists in Redis but NOT in database. Creating database entry...`)
    
    try {
      // Get user ID from email
      const [user] = await db
        .select()
        .from(userSchema)
        .where(eq(userSchema.email, email))
        .limit(1)
      
      if (!user) {
        console.log(`[GET_ACCOUNT] ERROR: No user found for email: ${email}`)
        return null
      }
      
      // Create the account in the database
      await db
        .insert(accountSchema)
        .values({
          id: redisAccount.id, // Use the existing Redis ID
          accountId: redisAccount.username, // Use username as account_id (Twitter screen name)
          createdAt: new Date(),
          updatedAt: new Date(),
          providerId: 'twitter',
          userId: user.id,
          accessToken: null, // We don't have these tokens stored in Redis
          accessSecret: null,
        })
        .onConflictDoNothing()
      
      console.log(`[GET_ACCOUNT] Successfully created database entry for account: ${redisAccount.id}`)
      
    } catch (error) {
      console.error(`[GET_ACCOUNT] Failed to create database entry for account: ${redisAccount.id}`, error)
      return null
    }
  }
  
  console.log(`[GET_ACCOUNT] Successfully found/created account in database: ${redisAccount.id}`)
  
  // Return the Redis account data
  return redisAccount
}
