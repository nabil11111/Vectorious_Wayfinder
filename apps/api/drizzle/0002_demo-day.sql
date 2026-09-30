CREATE TABLE "demo_day" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"clock_base" timestamp with time zone NOT NULL,
	"clock_set_at" timestamp with time zone NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"day" integer DEFAULT 1 NOT NULL,
	"seeded_at" timestamp with time zone,
	CONSTRAINT "demo_day_one_row" CHECK ("demo_day"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "fuel_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" text NOT NULL,
	"date" date NOT NULL,
	"litres" numeric(6, 1) NOT NULL,
	"trip_id" uuid,
	"note" text,
	CONSTRAINT "fuel_log_litres_positive" CHECK ("fuel_log"."litres" > 0)
);
--> statement-breakpoint
CREATE TABLE "vehicle_days_off" (
	"vehicle_id" text NOT NULL,
	"date" date NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "vehicle_days_off_vehicle_id_date_pk" PRIMARY KEY("vehicle_id","date")
);
--> statement-breakpoint
ALTER TABLE "fuel_log" ADD CONSTRAINT "fuel_log_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_log" ADD CONSTRAINT "fuel_log_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_days_off" ADD CONSTRAINT "vehicle_days_off_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_log_history_day" ON "fuel_log" USING btree ("vehicle_id","date") WHERE "fuel_log"."trip_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_log_trip" ON "fuel_log" USING btree ("trip_id") WHERE "fuel_log"."trip_id" is not null;