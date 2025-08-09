ALTER TABLE "tweets" ADD COLUMN "likes" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "tweets" ADD COLUMN "retweets" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "tweets" ADD COLUMN "replies" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "tweets" ADD COLUMN "impressions" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "tweets" ADD COLUMN "metrics_updated_at" timestamp;