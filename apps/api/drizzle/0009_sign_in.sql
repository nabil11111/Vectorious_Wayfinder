ALTER TABLE "users" ADD COLUMN "staff_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pin_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_pins" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password_hash";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_staff_id_unique" UNIQUE("staff_id");