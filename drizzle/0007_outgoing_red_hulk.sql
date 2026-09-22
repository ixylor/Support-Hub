CREATE TYPE "public"."mail_transport_kind" AS ENUM('smtp');--> statement-breakpoint
CREATE TABLE "mail_transports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "mail_transport_kind" NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"encrypted_password" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_transports" ADD CONSTRAINT "mail_transports_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_transports_one_active" ON "mail_transports" USING btree ("is_active") WHERE "mail_transports"."is_active" = true;