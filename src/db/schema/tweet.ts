import {
  json,
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
} from 'drizzle-orm/pg-core'
import { account, user } from './auth'
import { InferSelectModel } from 'drizzle-orm'

type Media = {
  s3Key: string // s3
  media_id?: string // twitter media ID (optional during processing)
  media_key?: string // twitter media key (optional)
  url?: string // public URL for the media
  type?: 'image' | 'gif' | 'video' // media type
  platform?: string // source platform (TikTok, Instagram, etc.)
  originalUrl?: string // original URL from social platform
  title?: string // video title
  duration?: number // video duration in seconds
  size?: number // size in bytes
}

export const tweets = pgTable('tweets', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  content: text('content').default('').notNull(),
  editorState: json('editor_state').default(null),
  media: json('media').$type<Media[]>().default([]),
  mediaIds: json('media_ids').$type<string[]>().default([]),
  s3Keys: json('s3_keys').$type<string[]>().default([]),
  qstashId: text('qstash_id'),
  twitterId: text('twitter_id'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('account_id')
    .notNull()
    .references(() => account.id, { onDelete: 'cascade' }),
  isQueued: boolean('is_queued').default(false),
  isScheduled: boolean('is_scheduled').default(false).notNull(),
  scheduledFor: timestamp('scheduled_for'),
  scheduledUnix: bigint('scheduled_unix', { mode: 'number' }),
  isPublished: boolean('is_published').default(false).notNull(),
  // Thread-related columns
  threadId: text('thread_id'), // UUID to group tweets in a thread
  position: integer('position').default(0), // Order within thread (0-based)
  replyToTweetId: text('reply_to_tweet_id'), // Twitter ID to reply to
  isThreadStart: boolean('is_thread_start').default(false), // True for first tweet in thread
  delayMs: integer('delay_ms').default(0), // Delay before posting this tweet
  // Note: Video processing is now handled by the video_jobs table
  // Engagement metrics columns
  likes: integer('likes').default(0), // Number of likes
  retweets: integer('retweets').default(0), // Number of retweets
  replies: integer('replies').default(0), // Number of replies
  impressions: integer('impressions').default(0), // Number of impressions
  metricsUpdatedAt: timestamp('metrics_updated_at'), // Last time metrics were updated
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type Tweet = InferSelectModel<typeof tweets>
export type TweetQuery = InferSelectModel<typeof tweets>
