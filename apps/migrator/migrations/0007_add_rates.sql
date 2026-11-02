CREATE TABLE "rates" (
	"date" date NOT NULL,
	"from" char(3) NOT NULL,
	"to" char(3) NOT NULL,
	"rate" numeric NOT NULL,
	"fixed" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rates_date_from_to_pk" PRIMARY KEY("date","from","to")
);
