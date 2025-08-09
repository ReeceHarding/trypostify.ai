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
  media_id: string // twitter
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
  // Thread support fields
  threadId: text('thread_id'), // Groups tweets into threads
  position: integer('position').default(0), // Order within thread (0 = first tweet)
  replyToTweetId: text('reply_to_tweet_id'), // Previous tweet's Twitter ID for reply chain
  isThreadStart: boolean('is_thread_start').default(false), // Marks the first tweet in a thread
  delayMs: integer('delay_ms').default(0), // Delay in milliseconds from previous tweet
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
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type Tweet = InferSelectModel<typeof tweets>
export type TweetQuery = InferSelectModel<typeof tweets>
