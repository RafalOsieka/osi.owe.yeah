CREATE TABLE "reminders" (
	"trip_id" uuid NOT NULL,
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminders_trip_id_from_id_to_id_pk" PRIMARY KEY("trip_id","from_id","to_id")
);
--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;