CREATE TABLE "video_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tweet_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"video_url" text NOT NULL,
	"platform" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"s3_key" text,
	"twitter_media_id" text,
	"qstash_id" text,
	"error_message" text,
	"retry_count" text DEFAULT '0',
	"video_metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
