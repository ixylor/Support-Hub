ALTER TYPE "public"."mailbox_provider" ADD VALUE 'google';--> statement-breakpoint
ALTER TABLE "mailbox_connections" ADD COLUMN "sync_cursor" text;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD COLUMN "provider_message_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "mailbox_connection_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "provider_thread_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_mailbox_connection_id_mailbox_connections_id_fk" FOREIGN KEY ("mailbox_connection_id") REFERENCES "public"."mailbox_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_connections_one_active" ON "mailbox_connections" USING btree ("status") WHERE "mailbox_connections"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_one_per_thread" ON "tickets" USING btree ("mailbox_connection_id","provider_thread_id");--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_provider_message_id_unique" UNIQUE("provider_message_id");