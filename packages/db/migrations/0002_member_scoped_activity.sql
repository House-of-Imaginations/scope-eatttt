DROP INDEX IF EXISTS "session_member_session_user_idx";--> statement-breakpoint
CREATE INDEX "session_member_session_user_idx" ON "session_member" USING btree ("session_id","user_id");--> statement-breakpoint
ALTER TABLE "swipe" ADD COLUMN "member_id" uuid;--> statement-breakpoint
UPDATE "swipe"
SET "member_id" = "session_member"."id"
FROM "session_member"
WHERE "session_member"."session_id" = "swipe"."session_id"
  AND "session_member"."user_id" = "swipe"."user_id";--> statement-breakpoint
ALTER TABLE "swipe" ALTER COLUMN "member_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "swipe" ADD CONSTRAINT "swipe_member_id_session_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."session_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DROP INDEX IF EXISTS "swipe_session_user_restaurant_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "swipe_session_member_restaurant_idx" ON "swipe" USING btree ("session_id","member_id","restaurant_id");--> statement-breakpoint
ALTER TABLE "vote" ADD COLUMN "member_id" uuid;--> statement-breakpoint
UPDATE "vote"
SET "member_id" = "session_member"."id"
FROM "session_member"
WHERE "session_member"."session_id" = "vote"."session_id"
  AND "session_member"."user_id" = "vote"."user_id";--> statement-breakpoint
ALTER TABLE "vote" ALTER COLUMN "member_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_member_id_session_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."session_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DROP INDEX IF EXISTS "vote_session_candidate_user_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "vote_session_candidate_member_idx" ON "vote" USING btree ("session_id","candidate_id","member_id");
