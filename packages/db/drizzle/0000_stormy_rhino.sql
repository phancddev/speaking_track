CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"question_id" uuid PRIMARY KEY NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drafts_content_length_check" CHECK (char_length(content) <= 100000)
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_type_check" CHECK (type in ('youtube.upload', 'youtube.poll-processing', 'youtube.delete', 'storage.cleanup', 'storage.expire-staging')),
	CONSTRAINT "outbox_events_attempts_nonnegative_check" CHECK (attempts >= 0)
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_prompt_length_check" CHECK (char_length(prompt) between 1 and 5000),
	CONSTRAINT "questions_position_nonnegative_check" CHECK (position >= 0)
);
--> statement-breakpoint
CREATE TABLE "recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"status" text NOT NULL,
	"storage_key" text,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"duration_ms" integer NOT NULL,
	"youtube_video_id" text,
	"youtube_privacy_status" text,
	"youtube_upload_session_uri_encrypted" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"staged_at" timestamp with time zone,
	"youtube_created_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "recordings_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "recordings_youtube_video_id_unique" UNIQUE("youtube_video_id"),
	CONSTRAINT "recordings_status_check" CHECK (status in ('STAGING', 'QUEUED', 'YOUTUBE_UPLOADING', 'YOUTUBE_PROCESSING', 'READY', 'FAILED', 'EXPIRED', 'DELETE_PENDING', 'DELETED')),
	CONSTRAINT "recordings_size_bytes_nonnegative_check" CHECK (size_bytes >= 0),
	CONSTRAINT "recordings_duration_ms_positive_check" CHECK (duration_ms > 0),
	CONSTRAINT "recordings_attempt_count_nonnegative_check" CHECK (attempt_count >= 0),
	CONSTRAINT "recordings_mime_type_check" CHECK ("recordings"."mime_type" in (concat('video/webm', chr(59), 'codecs=vp9,opus'), concat('video/webm', chr(59), 'codecs=vp8,opus'), 'video/mp4')),
	CONSTRAINT "recordings_failure_code_check" CHECK (failure_code in ('AUTH_REQUIRED', 'ADMIN_REQUIRED', 'RESOURCE_NOT_FOUND', 'DUPLICATE_TAG', 'LAST_ADMIN_REQUIRED', 'VALIDATION_FAILED', 'RECORDING_TOO_LARGE', 'UNSUPPORTED_MEDIA_TYPE', 'STORAGE_CAPACITY_LOW', 'UPLOAD_NOT_FOUND', 'UPLOAD_METADATA_MISMATCH', 'INVALID_RECORDING_STATE', 'YOUTUBE_NOT_CONNECTED', 'YOUTUBE_REAUTH_REQUIRED', 'YOUTUBE_QUOTA_EXCEEDED', 'YOUTUBE_PRIVATE_RESTRICTION', 'YOUTUBE_UPLOAD_AMBIGUOUS', 'YOUTUBE_PROCESSING_FAILED', 'EXTERNAL_SERVICE_UNAVAILABLE')),
	CONSTRAINT "recordings_youtube_privacy_status_check" CHECK (youtube_privacy_status in ('unlisted', 'private', 'public'))
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_owner_normalized_name_unique" UNIQUE("owner_id","normalized_name"),
	CONSTRAINT "tags_name_length_check" CHECK (char_length(name) between 1 and 50),
	CONSTRAINT "tags_color_key_check" CHECK (color in ('neutral', 'red', 'orange', 'amber', 'yellow', 'green', 'teal', 'cyan', 'blue', 'violet', 'purple', 'pink'))
);
--> statement-breakpoint
CREATE TABLE "topic_tags" (
	"topic_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "topic_tags_pk" PRIMARY KEY("topic_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topics_title_length_check" CHECK (char_length(title) between 1 and 160),
	CONSTRAINT "topics_description_length_check" CHECK (char_length(description) <= 5000)
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "youtube_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"channel_title" text NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"scope" text NOT NULL,
	"status" text NOT NULL,
	"connected_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_tags" ADD CONSTRAINT "topic_tags_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_tags" ADD CONSTRAINT "topic_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_connections" ADD CONSTRAINT "youtube_connections_connected_by_user_id_user_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events" USING btree ("available_at") WHERE "outbox_events"."published_at" is null;--> statement-breakpoint
CREATE INDEX "questions_topic_id_idx" ON "questions" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "questions_topic_position_idx" ON "questions" USING btree ("topic_id","position");--> statement-breakpoint
CREATE INDEX "recordings_question_id_idx" ON "recordings" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "recordings_owner_id_idx" ON "recordings" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "recordings_active_staging_idx" ON "recordings" USING btree ("status") WHERE "recordings"."storage_key" is not null;--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tags_owner_id_idx" ON "tags" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "topics_owner_id_idx" ON "topics" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "user_email_idx" ON "user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");