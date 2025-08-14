import { db } from '@/db'
import { user } from '@/db/schema'
import { sql } from 'drizzle-orm'
import { j } from '../jstack'

export const statsRouter = j.router({
  getUserCount: j.procedure
    .get(async ({ c }) => {
      console.log('[STATS] Fetching user count at', new Date().toISOString())
      
      // Count total users in the database
      const [result] = await db
        .select({ count: sql`count(*)` })
        .from(user)
      
      const count = Number(result?.count || 0)
      
      console.log('[STATS] User count retrieved:', count)
      
      return c.json({ 
        count,
        formattedCount: count.toLocaleString('en-US') 
      })
    }),
})

export default statsRouter
