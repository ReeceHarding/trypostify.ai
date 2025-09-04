import { pgTable, text, timestamp, foreignKey, unique, boolean, json, integer, bigint, index, numeric, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const knowledgeType = pgEnum("knowledge_type", ['url', 'txt', 'docx', 'pdf', 'image', 'manual'])


export const verification = pgTable("verification", {
	id: text().primaryKey().notNull(),
	identifier: text().notNull(),
	value: text().notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }),
	updatedAt: timestamp("updated_at", { mode: 'string' }),
});

export const account = pgTable("account", {
	id: text().primaryKey().notNull(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: text("user_id").notNull(),
	accessToken: text("access_token"),
	accessSecret: text("access_secret"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at", { mode: 'string' }),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { mode: 'string' }),
	scope: text(),
	password: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "account_user_id_user_id_fk"
		}).onDelete("cascade"),
]);

export const session = pgTable("session", {
	id: text().primaryKey().notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	token: text().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: text("user_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "session_user_id_user_id_fk"
		}).onDelete("cascade"),
	unique("session_token_unique").on(table.token),
]);

export const knowledgeDocument = pgTable("knowledge_document", {
	id: text().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	fileName: text("file_name").notNull(),
	type: knowledgeType().notNull(),
	s3Key: text("s3_key").notNull(),
	title: text(),
	description: text(),
	isDeleted: boolean("is_deleted").default(false).notNull(),
	isExample: boolean("is_example").default(false).notNull(),
	tags: json().default([]),
	editorState: json("editor_state").default(null),
	isStarred: boolean("is_starred").default(false).notNull(),
	sizeBytes: integer("size_bytes"),
	metadata: json().default({}),
	sourceUrl: text("source_url"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "knowledge_document_user_id_user_id_fk"
		}).onDelete("cascade"),
]);

export const knowledgeTags = pgTable("knowledge_tags", {
	id: text().primaryKey().notNull(),
	knowledgeId: text("knowledge_id").notNull(),
	tag: text().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.knowledgeId],
			foreignColumns: [knowledgeDocument.id],
			name: "knowledge_tags_knowledge_id_knowledge_document_id_fk"
		}).onDelete("cascade"),
]);

export const tweets = pgTable("tweets", {
	id: text().primaryKey().notNull(),
	content: text().default('').notNull(),
	editorState: json("editor_state").default(null),
	media: json().default([]),
	mediaIds: json("media_ids").default([]),
	s3Keys: json("s3_keys").default([]),
	qstashId: text("qstash_id"),
	twitterId: text("twitter_id"),
	userId: text("user_id").notNull(),
	accountId: text("account_id").notNull(),
	isQueued: boolean("is_queued").default(false),
	isScheduled: boolean("is_scheduled").default(false).notNull(),
	scheduledFor: timestamp("scheduled_for", { mode: 'string' }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	scheduledUnix: bigint("scheduled_unix", { mode: "number" }),
	isPublished: boolean("is_published").default(false).notNull(),
	threadId: text("thread_id"),
	position: integer().default(0),
	replyToTweetId: text("reply_to_tweet_id"),
	isThreadStart: boolean("is_thread_start").default(false),
	delayMs: integer("delay_ms").default(0),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	likes: integer().default(0),
	retweets: integer().default(0),
	replies: integer().default(0),
	impressions: integer().default(0),
	metricsUpdatedAt: timestamp("metrics_updated_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "tweets_user_id_user_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [account.id],
			name: "tweets_account_id_account_id_fk"
		}).onDelete("cascade"),
]);

export const mediaLibrary = pgTable("media_library", {
	id: text().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	s3Key: text("s3_key").notNull(),
	mediaId: text("media_id").notNull(),
	filename: text().notNull(),
	fileType: text("file_type").notNull(),
	mediaType: text("media_type").notNull(),
	sizeBytes: integer("size_bytes"),
	tags: json().default([]),
	isStarred: boolean("is_starred").default(false).notNull(),
	isDeleted: boolean("is_deleted").default(false).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("media_library_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("media_library_is_deleted_idx").using("btree", table.isDeleted.asc().nullsLast().op("bool_ops")),
	index("media_library_media_type_idx").using("btree", table.mediaType.asc().nullsLast().op("text_ops")),
	index("media_library_user_id_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "media_library_user_id_user_id_fk"
		}).onDelete("cascade"),
]);

export const user = pgTable("user", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	email: text().notNull(),
	emailVerified: boolean("email_verified").notNull(),
	image: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).notNull(),
	plan: text().default('pro').notNull(),
	stripeId: text("stripe_id"),
	hadTrial: boolean("had_trial").default(false),
	goals: json().default([]),
	frequency: integer(),
	hasXPremium: boolean("has_x_premium").default(false),
	postingWindowStart: integer("posting_window_start").default(8),
	postingWindowEnd: integer("posting_window_end").default(18),
}, (table) => [
	unique("user_email_unique").on(table.email),
	unique("user_stripe_id_unique").on(table.stripeId),
]);

export const twitterUser = pgTable("twitter_user", {
	id: text().primaryKey().notNull(),
	username: text().notNull(),
	name: text().notNull(),
	profileImageUrl: text("profile_image_url"),
	verified: boolean().default(false),
	followersCount: integer("followers_count"),
	description: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).notNull(),
	lastSearchedAt: timestamp("last_searched_at", { mode: 'string' }),
	searchCount: integer("search_count").default(0),
}, (table) => [
	index("twitter_user_name_idx").using("btree", sql`lower(name)`),
	index("twitter_user_search_count_idx").using("btree", table.searchCount.asc().nullsLast().op("int4_ops")),
	index("twitter_user_username_idx").using("btree", sql`lower(username)`),
	unique("twitter_user_username_unique").on(table.username),
]);

export const videoCache = pgTable("video_cache", {
	id: text().primaryKey().notNull(),
	originalUrl: text("original_url").notNull(),
	normalizedUrl: text("normalized_url").notNull(),
	s3Key: text("s3_key"),
	mediaId: text("media_id"),
	processingStatus: text("processing_status").default('pending').notNull(),
	apifyRunId: text("apify_run_id"),
	fileSize: integer("file_size"),
	durationSeconds: numeric("duration_seconds"),
	platform: text(),
	errorMessage: text("error_message"),
	retryCount: integer("retry_count").default(0),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	completedAt: timestamp("completed_at", { mode: 'string' }),
}, (table) => [
	unique("video_cache_original_url_unique").on(table.originalUrl),
]);
