CREATE TABLE "twitter_user" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"name" text NOT NULL,
	"profile_image_url" text,
	"verified" boolean DEFAULT false,
	"followers_count" integer,
	"description" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"last_searched_at" timestamp,
	"search_count" integer DEFAULT 0,
	CONSTRAINT "twitter_user_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE INDEX "twitter_user_username_idx" ON "twitter_user" USING btree (lower("username"));--> statement-breakpoint
CREATE INDEX "twitter_user_name_idx" ON "twitter_user" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "twitter_user_search_count_idx" ON "twitter_user" USING btree ("search_count");