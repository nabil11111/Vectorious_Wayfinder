CREATE TYPE "public"."trip_status" AS ENUM('planned', 'loading', 'ready', 'out', 'done');--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'split';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "split_from" uuid;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "saved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "mix_brands" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "sent_check" jsonb;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "status" "trip_status" DEFAULT 'planned' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_split_from_orders_id_fk" FOREIGN KEY ("split_from") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_split_from" ON "orders" USING btree ("split_from");