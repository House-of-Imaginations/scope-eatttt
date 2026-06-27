ALTER TABLE "lunch_session" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "lunch_session" ADD COLUMN "poll_duration_sec" integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE "lunch_session" ADD COLUMN "promote_threshold" integer DEFAULT 2 NOT NULL;
