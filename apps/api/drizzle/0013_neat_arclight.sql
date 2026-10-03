CREATE TABLE "outlet_receiving" (
	"outlet_id" text NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"revision" integer NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "outlet_receiving_outlet_id_date_pk" PRIMARY KEY("outlet_id","date"),
	CONSTRAINT "outlet_receiving_status" CHECK ("outlet_receiving"."status" in ('unconfirmed', 'ready', 'unavailable')),
	CONSTRAINT "outlet_receiving_revision" CHECK ("outlet_receiving"."revision" > 0),
	CONSTRAINT "outlet_receiving_note_length" CHECK (length("outlet_receiving"."note") <= 200)
);
--> statement-breakpoint
ALTER TABLE "outlet_receiving" ADD CONSTRAINT "outlet_receiving_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlet_receiving" ADD CONSTRAINT "outlet_receiving_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;