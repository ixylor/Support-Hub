INSERT INTO "agents" ("key", "name", "description", "temperature") VALUES
  ('manual_writer', 'Manual Reply Writer', 'Creates short, professional drafts for agents to review before sending.', '0.2')
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "agent_prompt_versions" ("agent_id", "content", "version", "is_active")
SELECT a.id,
  'You write short, professional customer support email drafts for a human agent. Use only the conversation provided. Be clear, warm, and direct. Do not invent facts, promises, links, or policies. Return plain text only. Keep the reply focused: normally 2 to 4 short paragraphs. Do not include a subject line, placeholder greeting, placeholder signature, or notes about the draft.',
  1, true
FROM "agents" a
WHERE a."key" = 'manual_writer'
  AND NOT EXISTS (
    SELECT 1 FROM "agent_prompt_versions" p
    WHERE p."agent_id" = a.id
  );
