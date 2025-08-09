CREATE TYPE "public"."knowledge_type" AS ENUM('url', 'txt', 'docx', 'pdf', 'image', 'manual');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"access_secret" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL,
	"image" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"stripe_id" text,
	"had_trial" boolean DEFAULT false,
	"goals" json DEFAULT '[]'::json,
	"frequency" integer,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_stripe_id_unique" UNIQUE("stripe_id")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "tweets" (
	"id" text PRIMARY KEY NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"editor_state" json DEFAULT 'null'::json,
	"media" json DEFAULT '[]'::json,
	"media_ids" json DEFAULT '[]'::json,
	"s3_keys" json DEFAULT '[]'::json,
	"qstash_id" text,
	"twitter_id" text,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"is_queued" boolean DEFAULT false,
	"is_scheduled" boolean DEFAULT false NOT NULL,
	"scheduled_for" timestamp,
	"scheduled_unix" bigint,
	"is_published" boolean DEFAULT false NOT NULL,
	"thread_id" text,
	"position" integer DEFAULT 0,
	"reply_to_tweet_id" text,
	"is_thread_start" boolean DEFAULT false,
	"delay_ms" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_document" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"file_name" text NOT NULL,
	"type" "knowledge_type" NOT NULL,
	"s3_key" text NOT NULL,
	"title" text,
	"description" text,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"is_example" boolean DEFAULT false NOT NULL,
	"tags" json DEFAULT '[]'::json,
	"editor_state" json DEFAULT 'null'::json,
	"is_starred" boolean DEFAULT false NOT NULL,
	"size_bytes" integer,
	"metadata" json DEFAULT '{}'::json,
	"source_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_tags" (
	"id" text PRIMARY KEY NOT NULL,
	"knowledge_id" text NOT NULL,
	"tag" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tweets" ADD CONSTRAINT "tweets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tweets" ADD CONSTRAINT "tweets_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document" ADD CONSTRAINT "knowledge_document_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_tags" ADD CONSTRAINT "knowledge_tags_knowledge_id_knowledge_document_id_fk" FOREIGN KEY ("knowledge_id") REFERENCES "public"."knowledge_document"("id") ON DELETE cascade ON UPDATE no action;