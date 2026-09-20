ALTER TABLE "topics" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "topics_owner_position_idx" ON "topics" USING btree ("owner_id", "position");--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_position_nonnegative_check" CHECK (position >= 0);--> statement-breakpoint
WITH "ranked" AS (
	SELECT "id", row_number() OVER (PARTITION BY "owner_id" ORDER BY "title", "created_at") - 1 AS "pos"
	FROM "topics"
	WHERE "deleted_at" IS NULL
)
UPDATE "topics" SET "position" = "ranked"."pos" FROM "ranked" WHERE "topics"."id" = "ranked"."id";--> statement-breakpoint
