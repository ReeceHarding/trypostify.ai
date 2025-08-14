import { db } from '@/db'
import { user } from '@/db/schema'
import { sql } from 'drizzle-orm'
import { j, publicProcedure } from '../jstack'

const statsRouter = j.router({
  getUserCount: publicProcedure
    .get(async ({ c }) => {
      console.log('[STATS] Fetching user count at', new Date().toISOString())
      
      try {
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
      } catch (error) {
        console.error('[STATS] Error fetching user count:', error)
        
        // Return fallback count if database query fails
        return c.json({ 
          count: 1140,
          formattedCount: '1,140' 
        })
      }
    }),
})

export default statsRouter
