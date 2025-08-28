ALTER TABLE "video_jobs" ADD COLUMN "transcoding_job_id" text;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "transcoded_s3_key" text;