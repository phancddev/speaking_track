CREATE TABLE "youtube_oauth_clients" (
	"user_id" text PRIMARY KEY REFERENCES "user"("id") ON DELETE cascade,
	"client_id" text NOT NULL,
	"encrypted_client_secret" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
-- Connections become per-user (id = user id); the dev-era singleton row is
-- obsolete under the per-user model and is removed here.
DELETE FROM "youtube_connections";--> statement-breakpoint
ALTER TABLE "youtube_connections" ADD CONSTRAINT "youtube_connections_id_user_id_fk" FOREIGN KEY ("id") REFERENCES "user"("id") ON DELETE cascade;
