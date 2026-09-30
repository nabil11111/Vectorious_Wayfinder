CREATE TYPE "public"."issue_kind" AS ENUM('loading');--> statement-breakpoint
CREATE TYPE "public"."issue_status" AS ENUM('open', 'decided');--> statement-breakpoint
CREATE TABLE "issue_lines" (
	"issue_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"counted" integer NOT NULL,
	CONSTRAINT "issue_lines_issue_id_order_line_id_pk" PRIMARY KEY("issue_id","order_line_id"),
	CONSTRAINT "issue_lines_counted" CHECK ("issue_lines"."counted" >= 0)
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "issue_kind" NOT NULL,
	"reason" text NOT NULL,
	"status" "issue_status" DEFAULT 'open' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"stop_id" uuid NOT NULL,
	"raised_by" uuid NOT NULL,
	"raised_at" timestamp with time zone NOT NULL,
	"note" text,
	"decision" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	CONSTRAINT "issues_decided" CHECK (("issues"."status" = 'open' and "issues"."decision" is null and "issues"."decided_by" is null and "issues"."decided_at" is null)
    or ("issues"."status" = 'decided' and "issues"."decision" is not null and "issues"."decided_by" is not null and "issues"."decided_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "loaded_qty" integer;--> statement-breakpoint
ALTER TABLE "stops" ADD COLUMN "loaded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "last_write_id" uuid;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issue_lines" ADD CONSTRAINT "issue_lines_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_lines" ADD CONSTRAINT "issue_lines_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_stop_id_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."stops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_raised_by_users_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issues_stop" ON "issues" USING btree ("stop_id");--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_loaded_qty" CHECK ("order_lines"."loaded_qty" between 0 and "order_lines"."quantity");