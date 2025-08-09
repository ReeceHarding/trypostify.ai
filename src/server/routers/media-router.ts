import { db } from '@/db'
import { mediaLibrary } from '@/db/schema'
import { and, eq, desc, sql, like, or } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { j, privateProcedure } from '../jstack'

export const mediaRouter = j.router({
  getMediaLibrary: privateProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        mediaType: z.enum(['image', 'gif', 'video']).optional(),
        search: z.string().optional(),
        isStarred: z.boolean().optional(),
      })
    )
    .post(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { limit, offset, mediaType, search, isStarred } = input

      // Build where conditions
      const conditions = [
        eq(mediaLibrary.userId, user.id),
        eq(mediaLibrary.isDeleted, false),
      ]

      if (mediaType) {
        conditions.push(eq(mediaLibrary.mediaType, mediaType))
      }

      if (isStarred !== undefined) {
        conditions.push(eq(mediaLibrary.isStarred, isStarred))
      }

      if (search) {
        const searchCondition = or(
          like(mediaLibrary.filename, `%${search}%`),
          // Search in tags array using JSON containment
          sql`${mediaLibrary.tags}::jsonb @> ${JSON.stringify([search])}`
        )
        if (searchCondition) {
          conditions.push(searchCondition)
        }
      }

      // Get total count
      const [countResult] = await db
        .select({ count: sql`count(*)` })
        .from(mediaLibrary)
        .where(and(...conditions))

      const total = Number(countResult?.count || 0)

      // Get paginated results
      const items = await db
        .select()
        .from(mediaLibrary)
        .where(and(...conditions))
        .orderBy(desc(mediaLibrary.createdAt))
        .limit(limit)
        .offset(offset)

      // Add S3 URLs to items
      const itemsWithUrls = items.map(item => ({
        ...item,
        url: `https://${process.env.NEXT_PUBLIC_S3_BUCKET_NAME}.s3.amazonaws.com/${item.s3Key}`,
      }))

      return c.superjson({
        items: itemsWithUrls,
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      })
    }),

  deleteMedia: privateProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { id } = input

      try {
        // Soft delete the media item
        const [deleted] = await db
          .update(mediaLibrary)
          .set({ 
            isDeleted: true,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(mediaLibrary.id, id),
              eq(mediaLibrary.userId, user.id),
              eq(mediaLibrary.isDeleted, false)
            )
          )
          .returning()

        if (!deleted) {
          throw new HTTPException(404, { message: 'Media item not found' })
        }

        return c.json({ success: true })
      } catch (error) {
        console.error('Error deleting media item:', error)
        
        if (error instanceof HTTPException) {
          throw error
        }

        throw new HTTPException(500, {
          message: 'Failed to delete media item',
        })
      }
    }),

  toggleStar: privateProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { id } = input

      try {
        // Get current starred status
        const [currentItem] = await db
          .select({ isStarred: mediaLibrary.isStarred })
          .from(mediaLibrary)
          .where(
            and(
              eq(mediaLibrary.id, id),
              eq(mediaLibrary.userId, user.id),
              eq(mediaLibrary.isDeleted, false)
            )
          )

        if (!currentItem) {
          throw new HTTPException(404, { message: 'Media item not found' })
        }

        // Toggle the starred status
        const [updated] = await db
          .update(mediaLibrary)
          .set({ 
            isStarred: !currentItem.isStarred,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(mediaLibrary.id, id),
              eq(mediaLibrary.userId, user.id)
            )
          )
          .returning()

        return c.json({ 
          success: true,
          isStarred: updated?.isStarred || false,
        })
      } catch (error) {
        console.error('Error toggling star status:', error)
        
        if (error instanceof HTTPException) {
          throw error
        }

        throw new HTTPException(500, {
          message: 'Failed to update star status',
        })
      }
    }),

  addTags: privateProcedure
    .input(
      z.object({
        id: z.string(),
        tags: z.array(z.string()),
      })
    )
    .mutation(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { id, tags } = input

      try {
        // Get current tags
        const [currentItem] = await db
          .select({ tags: mediaLibrary.tags })
          .from(mediaLibrary)
          .where(
            and(
              eq(mediaLibrary.id, id),
              eq(mediaLibrary.userId, user.id),
              eq(mediaLibrary.isDeleted, false)
            )
          )

        if (!currentItem) {
          throw new HTTPException(404, { message: 'Media item not found' })
        }

        // Merge tags (avoid duplicates)
        const currentTags = (currentItem.tags as string[]) || []
        const newTags = Array.from(new Set([...currentTags, ...tags]))

        // Update tags
        const [updated] = await db
          .update(mediaLibrary)
          .set({ 
            tags: newTags,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(mediaLibrary.id, id),
              eq(mediaLibrary.userId, user.id)
            )
          )
          .returning()

        return c.json({ 
          success: true,
          tags: updated?.tags || [],
        })
      } catch (error) {
        console.error('Error adding tags:', error)
        
        if (error instanceof HTTPException) {
          throw error
        }

        throw new HTTPException(500, {
          message: 'Failed to add tags',
        })
      }
    }),

  removeTags: privateProcedure
    .input(
      z.object({
        id: z.string(),
        tags: z.array(z.string()),
      })
    )
    .mutation(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { id, tags } = input

      try {
        // Get current tags
        const [currentItem] = await db
          .select({ tags: mediaLibrary.tags })
          .from(mediaLibrary)
          .where(
            and(
              eq(mediaLibrary.id, id),
              eq(mediaLibrary.userId, user.id),
              eq(mediaLibrary.isDeleted, false)
            )
          )

        if (!currentItem) {
          throw new HTTPException(404, { message: 'Media item not found' })
        }

        // Remove specified tags
        const currentTags = (currentItem.tags as string[]) || []
        const newTags = currentTags.filter(tag => !tags.includes(tag))

        // Update tags
        const [updated] = await db
          .update(mediaLibrary)
          .set({ 
            tags: newTags,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(mediaLibrary.id, id),
              eq(mediaLibrary.userId, user.id)
            )
          )
          .returning()

        return c.json({ 
          success: true,
          tags: updated?.tags || [],
        })
      } catch (error) {
        console.error('Error removing tags:', error)
        
        if (error instanceof HTTPException) {
          throw error
        }

        throw new HTTPException(500, {
          message: 'Failed to remove tags',
        })
      }
    }),
})
