ALTER TABLE "video_jobs" ALTER COLUMN "retry_count" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "video_jobs" ALTER COLUMN "retry_count" SET DEFAULT '0';