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
  
  // Check if this account exists in the database and has valid access tokens
  const [dbAccount] = await db
    .select()
    .from(accountSchema)
    .where(eq(accountSchema.id, redisAccount.id))
    .limit(1)
  
  if (!dbAccount) {
    console.log(`[GET_ACCOUNT] Account ${redisAccount.id} exists in Redis but NOT in database - this account was not properly connected via OAuth`)
    console.log(`[GET_ACCOUNT] Redis accounts should only exist after successful OAuth callback which creates database records`)
    return null
  }
  
  // Verify the account has valid access tokens
  if (!dbAccount.accessToken || !dbAccount.accessSecret) {
    console.log(`[GET_ACCOUNT] Account ${redisAccount.id} exists but missing access tokens - OAuth flow incomplete`)
    console.log(`[GET_ACCOUNT] AccessToken present: ${Boolean(dbAccount.accessToken)}, AccessSecret present: ${Boolean(dbAccount.accessSecret)}`)
    console.log(`[GET_ACCOUNT] Account last updated: ${dbAccount.updatedAt}`)
    console.log(`[GET_ACCOUNT] This typically means the user needs to reconnect their Twitter account in Settings`)
    return null
  }
  
  console.log(`[GET_ACCOUNT] Successfully found/created account in database: ${redisAccount.id}`)
  
  // Return the Redis account data
  return redisAccount
}

// Helper to sync account data between DB and Redis
export const syncAccountData = async (userId: string, accountId: string, email: string) => {
  const [dbAccount] = await db
    .select()
    .from(accountSchema)
    .where(and(eq(accountSchema.userId, userId), eq(accountSchema.id, accountId)))
    .limit(1)

  if (!dbAccount) {
    return null
  }

  const redisAccount = await redis.json.get<Account>(`account:${email}:${accountId}`)
  
  if (!redisAccount) {
    // Redis missing but DB exists - shouldn't happen but handle gracefully
    console.log(`[SYNC_ACCOUNT] Redis data missing for account ${accountId}, cannot sync`)
    return null
  }

  // Return combined data with DB validation
  return {
    ...redisAccount,
    hasValidTokens: Boolean(dbAccount.accessToken && dbAccount.accessSecret),
    needsReconnection: !dbAccount.accessToken || !dbAccount.accessSecret
  }
}
