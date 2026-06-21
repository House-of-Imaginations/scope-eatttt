CREATE TYPE "public"."session_status" AS ENUM('lobby', 'swiping', 'polling', 'decided', 'closed');--> statement-breakpoint
CREATE TYPE "public"."swipe_decision" AS ENUM('accept', 'reject');--> statement-breakpoint
CREATE TABLE "lunch_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"join_code" text NOT NULL,
	"host_user_id" text NOT NULL,
	"status" "session_status" DEFAULT 'lobby' NOT NULL,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"radius_m" integer DEFAULT 500 NOT NULL,
	"cuisines" text[] DEFAULT '{}' NOT NULL,
	"poll_deadline_at" timestamp with time zone,
	"winner_candidate_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lunch_session_join_code_unique" UNIQUE("join_code")
);
--> statement-breakpoint
CREATE TABLE "poll_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"restaurant_id" text NOT NULL,
	"promoted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"is_host" boolean DEFAULT false NOT NULL,
	"radius_m" integer DEFAULT 500 NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swipe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"restaurant_id" text NOT NULL,
	"decision" "swipe_decision" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restaurant_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"cuisine_tags" text[] DEFAULT '{}' NOT NULL,
	"lat" real,
	"lng" real,
	"rating" real,
	"price_level" integer,
	"distance_m" integer,
	"cached_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vote" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"value" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
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
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
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
CREATE TABLE "outbox_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "lunch_session" ADD CONSTRAINT "lunch_session_host_user_id_user_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_candidate" ADD CONSTRAINT "poll_candidate_session_id_lunch_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lunch_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_candidate" ADD CONSTRAINT "poll_candidate_restaurant_id_restaurant_cache_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurant_cache"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_member" ADD CONSTRAINT "session_member_session_id_lunch_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lunch_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_member" ADD CONSTRAINT "session_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swipe" ADD CONSTRAINT "swipe_session_id_lunch_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lunch_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swipe" ADD CONSTRAINT "swipe_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_session_id_lunch_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lunch_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_candidate_id_poll_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."poll_candidate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "lunch_session_join_code_idx" ON "lunch_session" USING btree ("join_code");--> statement-breakpoint
CREATE INDEX "lunch_session_host_idx" ON "lunch_session" USING btree ("host_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "poll_candidate_session_restaurant_idx" ON "poll_candidate" USING btree ("session_id","restaurant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_member_session_user_idx" ON "session_member" USING btree ("session_id","user_id");--> statement-breakpoint
CREATE INDEX "session_member_session_idx" ON "session_member" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "swipe_session_user_restaurant_idx" ON "swipe" USING btree ("session_id","user_id","restaurant_id");--> statement-breakpoint
CREATE INDEX "swipe_session_restaurant_idx" ON "swipe" USING btree ("session_id","restaurant_id");--> statement-breakpoint
CREATE INDEX "restaurant_cache_cached_at_idx" ON "restaurant_cache" USING btree ("cached_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vote_session_candidate_user_idx" ON "vote" USING btree ("session_id","candidate_id","user_id");--> statement-breakpoint
CREATE INDEX "vote_session_candidate_idx" ON "vote" USING btree ("session_id","candidate_id");--> statement-breakpoint
CREATE INDEX "outbox_event_aggregate_idx" ON "outbox_event" USING btree ("aggregate","aggregate_id");--> statement-breakpoint
CREATE INDEX "outbox_event_dispatched_idx" ON "outbox_event" USING btree ("dispatched_at");
