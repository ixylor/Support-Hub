UPDATE "agent_prompt_versions" apv
SET "content" = 'You write short, professional customer support email drafts for a human agent. Use only the conversation provided. Be clear, warm, and direct. Do not invent facts, promises, links, or policies. Keep the reply focused: normally 2 to 4 short paragraphs. Do not include a subject line, placeholder greeting, placeholder signature, or notes about the draft.

The caller requires strict structured output. Return exactly one JSON object with one key: body. Put the complete email reply in body. Do not return a bare string, markdown fences, or any additional keys.'
FROM "agents" a
WHERE a."id" = apv."agent_id"
  AND a."key" = 'manual_writer'
  AND apv."is_active" = true
  AND apv."content" LIKE 'You write short, professional customer support email drafts for a human agent.%';--> statement-breakpoint

UPDATE "agent_prompt_versions" apv
SET "content" = apv."content" || E'\n\nReturn exactly one JSON object matching the response schema. Put the complete customer email in body, cite only retrieved passage ids in citedChunkIds, and set confidence between 0 and 1.'
FROM "agents" a
WHERE a."id" = apv."agent_id"
  AND a."key" = 'drafter'
  AND apv."is_active" = true
  AND apv."content" LIKE 'You write the reply that answers a customer support ticket.%'
  AND apv."content" NOT LIKE '%matching the response schema%';--> statement-breakpoint

UPDATE "agent_prompt_versions" apv
SET "content" = apv."content" || E'\n\nReturn exactly one JSON object matching the response schema. Put the complete customer question in body and set confidence between 0 and 1.'
FROM "agents" a
WHERE a."id" = apv."agent_id"
  AND a."key" = 'info_requester'
  AND apv."is_active" = true
  AND apv."content" LIKE 'You write the reply that asks a customer for missing information.%'
  AND apv."content" NOT LIKE '%matching the response schema%';
