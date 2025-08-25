import { pgTable, text, timestamp, boolean, json } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { tweets, user } from './index'

export const videoJob = pgTable('video_jobs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  tweetId: text('tweet_id').notNull(), // The tweet this video should attach to
  threadId: text('thread_id').notNull(), // The thread this video belongs to
  videoUrl: text('video_url').notNull(), // Original video URL
  platform: text('platform').notNull(), // instagram, tiktok, etc.
  
  // Processing status
  status: text('status').notNull().default('pending'), // pending, processing, completed, failed
  
  // Results when completed
  s3Key: text('s3_key'), // S3 location of downloaded video
  twitterMediaId: text('twitter_media_id'), // Twitter media_id after upload
  
  // QStash tracking
  qstashId: text('qstash_id'), // QStash message ID for background processing
  
  // Error handling
  errorMessage: text('error_message'),
  retryCount: text('retry_count').default('0'),
  
  // Metadata
  videoMetadata: json('video_metadata'), // Duration, dimensions, etc.
  tweetContent: json('tweet_content'), // Complete tweet data for posting when video is ready
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
})

export const videoJobRelations = relations(videoJob, ({ one }) => ({
  user: one(user, {
    fields: [videoJob.userId],
    references: [user.id],
  }),
  tweet: one(tweets, {
    fields: [videoJob.tweetId],
    references: [tweets.id],
  }),
}))

export type VideoJob = typeof videoJob.$inferSelect
export type NewVideoJob = typeof videoJob.$inferInsert
