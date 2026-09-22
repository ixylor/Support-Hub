CREATE TYPE "public"."send_attempt_status" AS ENUM('sending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "ticket_send_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"status" "send_attempt_status" DEFAULT 'sending' NOT NULL,
	"provider_message_id" text,
	"message_id_header" text,
	"error_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "ticket_send_attempts_approval_id_unique" UNIQUE("approval_id")
);
--> statement-breakpoint
ALTER TABLE "ticket_send_attempts" ADD CONSTRAINT "ticket_send_attempts_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;