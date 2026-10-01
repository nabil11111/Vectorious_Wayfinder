CREATE TYPE "public"."stop_outcome" AS ENUM('delivered', 'refused', 'closed');--> statement-breakpoint
ALTER TYPE "public"."issue_kind" ADD VALUE 'refused';--> statement-breakpoint
ALTER TYPE "public"."issue_kind" ADD VALUE 'closed';--> statement-breakpoint
CREATE TABLE "driver_writes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"driver_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body_hash" text NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"stop_id" uuid NOT NULL,
	"issue_id" uuid,
	"jpeg" "bytea" NOT NULL,
	"taken_by" uuid NOT NULL,
	"taken_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "delivered_qty" integer;--> statement-breakpoint
ALTER TABLE "stops" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stops" ADD COLUMN "retried_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stops" ADD COLUMN "arrived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stops" ADD COLUMN "done_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stops" ADD COLUMN "outcome" "stop_outcome";--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "left_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "back_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "last_event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "driver_writes" ADD CONSTRAINT "driver_writes_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_writes" ADD CONSTRAINT "driver_writes_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_stop_id_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."stops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_taken_by_users_id_fk" FOREIGN KEY ("taken_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "driver_writes_driver" ON "driver_writes" USING btree ("driver_id","answered_at");--> statement-breakpoint
CREATE UNIQUE INDEX "photos_issue" ON "photos" USING btree ("issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "photos_proof" ON "photos" USING btree ("stop_id") WHERE "photos"."issue_id" is null;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_delivered_qty" CHECK ("order_lines"."delivered_qty" between 0 and "order_lines"."loaded_qty");--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_done" CHECK (("stops"."outcome" is null and "stops"."done_at" is null) or ("stops"."outcome" is not null and "stops"."done_at" is not null and "stops"."arrived_at" is not null));