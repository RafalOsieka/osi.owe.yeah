CREATE TABLE "revisions" (
	"expense_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"trip_id" uuid NOT NULL,
	"state" jsonb NOT NULL,
	"deleted" boolean NOT NULL,
	"claim_id" uuid,
	"device_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revisions_expense_id_version_pk" PRIMARY KEY("expense_id","version")
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "deleted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "revisions_trip_id_index" ON "revisions" USING btree ("trip_id");--> statement-breakpoint
-- Expenses from before Revisions get one for the version they are at, made by whoever made it.
INSERT INTO "revisions" ("expense_id", "version", "trip_id", "state", "deleted", "claim_id", "device_id", "created_at")
SELECT e."id", e."version", e."trip_id", e."state", false, c."claim_id", coalesce(c."device_id", 'unknown'), coalesce(c."created_at", e."updated_at")
FROM "expenses" e
LEFT JOIN "changes" c ON c."subject_id" = e."id" AND c."version" = e."version";
