CREATE TYPE "public"."approval_decision" AS ENUM('approve', 'edit', 'reject_feedback', 'override', 'take_over');--> statement-breakpoint
CREATE TYPE "public"."approval_kind" AS ENUM('send_email', 'triage_out', 'escalate', 'close');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'decided', 'superseded');--> statement-breakpoint
ALTER TYPE "public"."ticket_status" ADD VALUE 'triaged_out';--> statement-breakpoint
CREATE TABLE "ticket_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"graph_thread_id" text NOT NULL,
	"kind" "approval_kind" NOT NULL,
	"proposal" jsonb NOT NULL,
	"confidence" numeric NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"decision" "approval_decision",
	"edited_body" text,
	"feedback" text,
	"override_action" text,
	"decided_by_user_id" text,
	"decided_at" timestamp with time zone,
	"auto_approved_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"require_approval" boolean DEFAULT true NOT NULL,
	"auto_send_min_confidence" numeric DEFAULT '0.8' NOT NULL,
	"updated_by_user_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_logs" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "llm_logs" ADD COLUMN "graph_thread_id" text;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD COLUMN "approval_id" uuid;--> statement-breakpoint
ALTER TABLE "ticket_approvals" ADD CONSTRAINT "ticket_approvals_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_approvals" ADD CONSTRAINT "ticket_approvals_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_settings" ADD CONSTRAINT "workflow_settings_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_approvals_one_pending_per_thread" ON "ticket_approvals" USING btree ("graph_thread_id") WHERE "ticket_approvals"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "ticket_approvals_ticket_id_idx" ON "ticket_approvals" USING btree ("ticket_id");--> statement-breakpoint
ALTER TABLE "llm_logs" ADD CONSTRAINT "llm_logs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "workflow_settings" ("is_enabled", "require_approval", "auto_send_min_confidence")
VALUES (true, true, '0.8');