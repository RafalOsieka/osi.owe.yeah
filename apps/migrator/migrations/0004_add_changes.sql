CREATE TABLE "changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"trip_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"version" integer,
	"claim_id" uuid,
	"device_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "changes_trip_id_index" ON "changes" USING btree ("trip_id");--> statement-breakpoint
ALTER TABLE "expenses" DROP COLUMN "last_change_id";