CREATE TYPE "public"."agent_key" AS ENUM('drafter', 'info_requester', 'router', 'triage');--> statement-breakpoint
CREATE TABLE "agent_prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"content" text NOT NULL,
	"version" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" "agent_key" NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"ai_deployment_id" uuid,
	"temperature" numeric DEFAULT '0.2' NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "agent_prompt_versions" ADD CONSTRAINT "agent_prompt_versions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_prompt_versions" ADD CONSTRAINT "agent_prompt_versions_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_ai_deployment_id_ai_deployments_id_fk" FOREIGN KEY ("ai_deployment_id") REFERENCES "public"."ai_deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_prompt_versions_one_active_per_agent" ON "agent_prompt_versions" USING btree ("agent_id") WHERE "agent_prompt_versions"."is_active" = true;--> statement-breakpoint
CREATE INDEX "agent_prompt_versions_agent_id_idx" ON "agent_prompt_versions" USING btree ("agent_id");
--> statement-breakpoint
INSERT INTO "agents" ("key", "name", "description", "temperature") VALUES
  ('triage', 'Triage', 'Decides whether an inbound email is a genuine support request, and assigns its category and priority.', '0.0'),
  ('router', 'Router', 'Decides whether a ticket can be answered now, needs more information from the customer, or must be escalated.', '0.0'),
  ('info_requester', 'Information Requester', 'Writes the reply that asks the customer for the specific details still missing.', '0.3'),
  ('drafter', 'Drafter', 'Writes the answer, grounded in the retrieved knowledge base passages.', '0.3');
--> statement-breakpoint
INSERT INTO "agent_prompt_versions" ("agent_id", "content", "version", "is_active")
SELECT a.id, p.content, 1, true
FROM "agents" a
JOIN (VALUES
  ('triage', 'You classify inbound support email.

Decide whether the message is a genuine support request from a real person.
It is NOT genuine when it is unsolicited marketing, an automated notification
no one expects a reply to, unrelated to this product, or so anonymous that
there is no identifiable requester to help.

Then assign a category and a priority. Priority reflects customer impact:
urgent means they are blocked right now with no workaround.

Report your confidence as a number between 0 and 1. Be honest: a short or
ambiguous message should lower it.'),
  ('router', 'You decide what a support ticket needs next.

You are given the full conversation and the knowledge base passages retrieved
for it. Choose exactly one action:

- answer: the retrieved passages contain what is needed to resolve this.
- need_info: the customer has not said enough to act on. Choose this when the
  message describes a symptom without the specifics needed to diagnose it.
- escalate: this needs a person. Choose it when the knowledge base does not
  cover the problem and no reasonable follow-up question would change that,
  or when the request involves an account action you cannot take.

State your reason in one sentence. Report your confidence between 0 and 1.
Prefer escalate over guessing.'),
  ('info_requester', 'You write the reply that asks a customer for missing information.

Name the specific facts you need and why they help. Ask for the smallest set
that unblocks diagnosis — every extra question costs the customer a round trip.

Write plain text, no greeting placeholders, no invented product details. Be
brief and courteous. Do not promise a resolution time.'),
  ('drafter', 'You write the reply that answers a customer support ticket.

Ground every factual claim in the knowledge base passages provided. If a
passage does not cover part of the question, say what you do not know rather
than filling the gap. Never invent product behavior, URLs, or prices.

Write plain text, in a direct and courteous tone. Lead with the answer, then
the steps. Report your confidence between 0 and 1, reflecting how well the
passages actually covered the question.')
) AS p(key, content) ON p.key = a.key::text;
--> statement-breakpoint
UPDATE "agent_prompt_versions" apv
SET "content" = pt."content"
FROM "prompt_templates" pt, "agents" a
WHERE pt."key" = 'draft_reply_system'
  AND pt."is_active" = true
  AND a."key" = 'drafter'
  AND apv."agent_id" = a."id";
--> statement-breakpoint
ALTER TABLE "ticket_ai_drafts" DROP CONSTRAINT IF EXISTS "ticket_ai_drafts_prompt_template_id_prompt_templates_id_fk";
--> statement-breakpoint
ALTER TABLE "ticket_ai_drafts" DROP COLUMN "prompt_template_id";
--> statement-breakpoint
ALTER TABLE "ticket_ai_drafts" ADD COLUMN "agent_prompt_version_id" uuid NOT NULL REFERENCES "agent_prompt_versions"("id");
--> statement-breakpoint
DROP TABLE "prompt_templates";
