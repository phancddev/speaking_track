ALTER TABLE "drafts" ADD COLUMN "id" uuid NOT NULL DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "position" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_title_length_check" CHECK (char_length("title") <= 200);--> statement-breakpoint
ALTER TABLE "drafts" DROP CONSTRAINT "drafts_pkey";--> statement-breakpoint
ALTER TABLE "drafts" ADD PRIMARY KEY ("id");--> statement-breakpoint
CREATE INDEX "drafts_question_position_idx" ON "drafts" (question_id, position);--> statement-breakpoint
