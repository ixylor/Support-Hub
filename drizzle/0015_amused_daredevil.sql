ALTER TYPE "public"."agent_key" ADD VALUE IF NOT EXISTS 'manual_writer';--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_ticket_message_id_ticket_messages_id_fk";
--> statement-breakpoint
ALTER TABLE "llm_logs" DROP CONSTRAINT "llm_logs_ticket_id_tickets_id_fk";
--> statement-breakpoint
ALTER TABLE "ticket_approvals" DROP CONSTRAINT "ticket_approvals_ticket_id_tickets_id_fk";
--> statement-breakpoint
ALTER TABLE "ticket_assignments" DROP CONSTRAINT "ticket_assignments_ticket_id_tickets_id_fk";
--> statement-breakpoint
ALTER TABLE "ticket_messages" DROP CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk";
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_ticket_message_id_ticket_messages_id_fk" FOREIGN KEY ("ticket_message_id") REFERENCES "public"."ticket_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_logs" ADD CONSTRAINT "llm_logs_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_approvals" ADD CONSTRAINT "ticket_approvals_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_assignments" ADD CONSTRAINT "ticket_assignments_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;
