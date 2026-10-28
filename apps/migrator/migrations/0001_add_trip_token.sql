ALTER TABLE "trips" ADD COLUMN "token_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_tokenHash_unique" UNIQUE("token_hash");