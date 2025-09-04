import { pgTable, text, timestamp, boolean, integer, json, index, unique } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  plan: text('plan', { enum: ['free', 'pro'] })
    .notNull()
    .default('free'),
  stripeId: text('stripe_id').unique(),
  hadTrial: boolean('had_trial').default(false),
  goals: json('goals').$type<string[]>().default([]),
  frequency: integer('frequency'),
  hasXPremium: boolean('has_x_premium').default(false),
  postingWindowStart: integer('posting_window_start').default(8), // Hour (0-23) when posting window opens, default 8am
  postingWindowEnd: integer('posting_window_end').default(18), // Hour (0-23) when posting window closes, default 6pm
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  accessSecret: text("access_secret"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
})

// Table to store Twitter user profiles for mention search
export const twitterUser = pgTable('twitter_user', {
  id: text('id').primaryKey(), // Twitter user ID
  username: text('username').notNull(),
  name: text('name').notNull(),
  profileImageUrl: text('profile_image_url'),
  verified: boolean('verified').default(false),
  followersCount: integer('followers_count'),
  description: text('description'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  lastSearchedAt: timestamp('last_searched_at'), // Track when this user was last searched
  searchCount: integer('search_count').default(0), // Track how often this user is searched
}, (table) => [
  // Index for fast username search (case-insensitive)
  index('twitter_user_username_idx').on(sql`lower(${table.username})`),
  // Index for fast name search (case-insensitive)  
  index('twitter_user_name_idx').on(sql`lower(${table.name})`),
  // Index for search popularity
  index('twitter_user_search_count_idx').on(table.searchCount),
  // Unique constraint on username
  unique('twitter_user_username_unique').on(table.username),
])

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
})
