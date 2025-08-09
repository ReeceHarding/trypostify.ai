CREATE TABLE "media_library" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"s3_key" text NOT NULL,
	"media_id" text NOT NULL,
	"filename" text NOT NULL,
	"file_type" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" integer,
	"tags" json DEFAULT '[]'::json,
	"is_starred" boolean DEFAULT false NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_library" ADD CONSTRAINT "media_library_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_library_user_id_idx" ON "media_library" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "media_library_media_type_idx" ON "media_library" USING btree ("media_type");--> statement-breakpoint
CREATE INDEX "media_library_is_deleted_idx" ON "media_library" USING btree ("is_deleted");--> statement-breakpoint
CREATE INDEX "media_library_created_at_idx" ON "media_library" USING btree ("created_at");