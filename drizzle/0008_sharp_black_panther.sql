ALTER TYPE "public"."ticket_status" ADD VALUE 'triaged_out';--> statement-breakpoint
ALTER TABLE "ticket_ai_drafts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "ticket_ai_drafts" CASCADE;--> statement-breakpoint
ALTER TABLE "llm_logs" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "llm_logs" ADD COLUMN "graph_thread_id" text;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD COLUMN "approval_id" uuid;--> statement-breakpoint
ALTER TABLE "llm_logs" ADD CONSTRAINT "llm_logs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;