CREATE TYPE "public"."brand" AS ENUM('Fresh', 'Style', 'Tech');--> statement-breakpoint
CREATE TYPE "public"."dock_type" AS ENUM('street', 'rear_dock', 'mall_bay');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('draft', 'placed', 'planned', 'deferred', 'loaded', 'delivered', 'received', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."parking" AS ENUM('normal', 'van_only', 'mall_dock');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('store_manager', 'dispatcher', 'loader', 'driver', 'admin');--> statement-breakpoint
CREATE TYPE "public"."temp" AS ENUM('chilled', 'dry');--> statement-breakpoint
CREATE TYPE "public"."vehicle_temp" AS ENUM('reefer', 'ambient');--> statement-breakpoint
CREATE TYPE "public"."vehicle_type" AS ENUM('truck', 'van');--> statement-breakpoint
CREATE TABLE "calendar_days" (
	"date" date PRIMARY KEY NOT NULL,
	"dow" smallint NOT NULL,
	"is_weekend" boolean NOT NULL,
	"iso_year" smallint NOT NULL,
	"iso_week" smallint NOT NULL,
	"is_payday" boolean NOT NULL,
	"festival" text,
	"festival_ramp" numeric(4, 2) NOT NULL,
	"is_holiday" boolean NOT NULL,
	"monsoon" boolean NOT NULL,
	"is_operating" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "depots" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "district_travel" (
	"district" text NOT NULL,
	"depot_id" text NOT NULL,
	"road_class" text NOT NULL,
	"free_flow_kmh" numeric(5, 1) NOT NULL,
	"depot_to_district_km" integer NOT NULL,
	"depot_to_district_min" integer NOT NULL,
	"inter_stop_km" numeric(5, 1) NOT NULL,
	"inter_stop_min" integer NOT NULL,
	CONSTRAINT "district_travel_district_depot_id_pk" PRIMARY KEY("district","depot_id")
);
--> statement-breakpoint
CREATE TABLE "outlets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"brand" "brand" NOT NULL,
	"district" text NOT NULL,
	"depot_id" text NOT NULL,
	"dock_type" "dock_type" NOT NULL,
	"parking" "parking" NOT NULL,
	"mall_window" text,
	"window_open" time NOT NULL,
	"window_close" time NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"brand" "brand" NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"kg_per_unit" numeric(7, 2) NOT NULL,
	"m3_per_unit" numeric(6, 3) NOT NULL,
	"temp" "temp" NOT NULL,
	"needs_tail_lift" boolean DEFAULT false NOT NULL,
	"keep_upright" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "service_allowance" (
	"brand" "brand" NOT NULL,
	"dock_type" "dock_type" NOT NULL,
	"minutes" integer NOT NULL,
	CONSTRAINT "service_allowance_brand_dock_type_pk" PRIMARY KEY("brand","dock_type")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "vehicle_type" NOT NULL,
	"temp" "vehicle_temp" NOT NULL,
	"weight_cap_kg" integer NOT NULL,
	"volume_cap_m3" numeric(6, 2) NOT NULL,
	"fuel_type" text NOT NULL,
	"km_per_l" numeric(5, 2) NOT NULL,
	"weekly_fuel_quota_l" integer NOT NULL,
	"depot_id" text NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"role" "role" NOT NULL,
	"password_hash" text NOT NULL,
	"outlet_id" text,
	"depot_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "order_lines_quantity_positive" CHECK ("order_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" text NOT NULL,
	"delivery_date" date NOT NULL,
	"temp" "temp" NOT NULL,
	"status" "order_status" DEFAULT 'draft' NOT NULL,
	"driver_note" text,
	"created_by" uuid,
	"placed_at" timestamp with time zone,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deferrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"code" text NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "deferrals_plan_order" UNIQUE("plan_id","order_id")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"depot_id" text NOT NULL,
	"date" date NOT NULL,
	"status" "plan_status" DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_depot_date" UNIQUE("depot_id","date")
);
--> statement-breakpoint
CREATE TABLE "stop_orders" (
	"stop_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	CONSTRAINT "stop_orders_stop_id_order_id_pk" PRIMARY KEY("stop_id","order_id")
);
--> statement-breakpoint
CREATE TABLE "stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"outlet_id" text NOT NULL,
	"planned_arrival" time,
	"planned_depart" time,
	CONSTRAINT "stops_trip_seq" UNIQUE("trip_id","seq")
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"vehicle_id" text NOT NULL,
	"driver_id" uuid,
	"trip_no" smallint NOT NULL,
	"depart_at" time,
	CONSTRAINT "trips_vehicle_trip" UNIQUE("plan_id","vehicle_id","trip_no")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "district_travel" ADD CONSTRAINT "district_travel_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deferrals" ADD CONSTRAINT "deferrals_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deferrals" ADD CONSTRAINT "deferrals_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stop_orders" ADD CONSTRAINT "stop_orders_stop_id_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."stops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stop_orders" ADD CONSTRAINT "stop_orders_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;