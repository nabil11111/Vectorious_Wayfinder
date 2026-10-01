ALTER TYPE "public"."issue_kind" ADD VALUE 'receipt';--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "received_qty" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "receipt_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "arrived_cold" boolean;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "replaces_issue_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_replaces_issue_id_issues_id_fk" FOREIGN KEY ("replaces_issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_replaces" ON "orders" USING btree ("replaces_issue_id");--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_received_qty" CHECK ("order_lines"."received_qty" between 0 and "order_lines"."delivered_qty");