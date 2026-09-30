ALTER TABLE "orders" ADD COLUMN "placed_by" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "saved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_placed_by_users_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_one_draft" ON "orders" USING btree ("outlet_id","temp") WHERE "orders"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "orders_outlet_date" ON "orders" USING btree ("outlet_id","delivery_date");--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_product" UNIQUE("order_id","product_id");