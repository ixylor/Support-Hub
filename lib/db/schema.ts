import {
  pgEnum,
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  integer,
  boolean,
  vector,
  index,
  uniqueIndex,
  customType,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "@/lib/auth/schema";

export const mailboxProviderEnum = pgEnum("mailbox_provider", ["microsoft", "google"]);
export const mailboxStatusEnum = pgEnum("mailbox_status", [
  "active",
  "disconnected",
  "error",
]);

// A single shared team mailbox connected via Microsoft Graph OAuth.
// Not designed for per-agent mailboxes — see Foundation spec.
export const mailboxConnections = pgTable(
  "mailbox_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: mailboxProviderEnum("provider").notNull(),
    mailboxAddress: text("mailbox_address").notNull(),
    encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
    connectedByUserId: text("connected_by_user_id")
      .notNull()
      .references(() => user.id),
    status: mailboxStatusEnum("status").notNull().default("active"),
    // Opaque per-provider checkpoint (an ISO timestamp of the last message
    // ingested) so polling resumes without re-scanning the whole inbox.
    syncCursor: text("sync_cursor"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // At most one mailbox is ever "active" — same one-row-per-key trick as
    // ai_deployments_one_active_per_role.
    uniqueIndex("mailbox_connections_one_active")
      .on(table.status)
      .where(sql`${table.status} = 'active'`),
  ]
);

// Gmail's date-based polling can return a message more than once. Keep a
// durable marker for intentionally deleted conversations so removing their
// ticket/message rows doesn't make a later poll recreate the same thread.
export const deletedGoogleThreads = pgTable(
  "deleted_google_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mailboxAddress: text("mailbox_address").notNull(),
    providerThreadId: text("provider_thread_id").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("deleted_google_threads_mailbox_thread_idx").on(
      table.mailboxAddress,
      table.providerThreadId
    ),
  ]
);

export const ticketStatusEnum = pgEnum("ticket_status", [
  "new",
  "pending_review",
  "approved",
  "escalated",
  "resolved",
  "waiting_on_customer",
  "triaged_out",
]);
export const ticketCategoryEnum = pgEnum("ticket_category", [
  "billing",
  "technical",
  "general",
  "other",
]);
export const ticketPriorityEnum = pgEnum("ticket_priority", [
  "low",
  "medium",
  "high",
  "urgent",
]);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subject: text("subject").notNull(),
    requesterEmail: text("requester_email").notNull(),
    status: ticketStatusEnum("status").notNull().default("new"),
    category: ticketCategoryEnum("category"),
    priority: ticketPriorityEnum("priority"),
    confidenceScore: numeric("confidence_score"),
    mailboxConnectionId: uuid("mailbox_connection_id")
      .notNull()
      .references(() => mailboxConnections.id),
    providerThreadId: text("provider_thread_id").notNull(),
    // Null means unassigned. Agents only ever see tickets pointing at them;
    // admins see every ticket regardless. See lib/tickets/queries.ts.
    assignedToUserId: text("assigned_to_user_id").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("tickets_one_per_thread").on(table.mailboxConnectionId, table.providerThreadId),
    // Every agent-facing query filters on this column, so it carries the
    // whole non-admin ticket list.
    index("tickets_assigned_to_user_id_idx").on(table.assignedToUserId),
  ]
);

// Append-only audit of every assign, reassign and unassign. Nothing here is
// ever updated or deleted — the current assignee lives on tickets; this is
// the history behind it.
export const ticketAssignments = pgTable(
  "ticket_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    // Null records an unassignment.
    assignedToUserId: text("assigned_to_user_id").references(() => user.id),
    assignedByUserId: text("assigned_by_user_id")
      .notNull()
      .references(() => user.id),
    // The priority chosen at assignment time, if the admin set one. Kept
    // separate from tickets.priority so later changes do not rewrite history.
    priority: ticketPriorityEnum("priority"),
    remark: text("remark"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ticket_assignments_ticket_id_idx").on(table.ticketId)]
);

export const messageDirectionEnum = pgEnum("message_direction", [
  "inbound",
  "outbound",
]);

export const ticketMessages = pgTable("ticket_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id")
    .notNull()
    .references(() => tickets.id, { onDelete: "cascade" }),
  direction: messageDirectionEnum("direction").notNull(),
  senderEmail: text("sender_email").notNull(),
  body: text("body").notNull(),
  providerMessageId: text("provider_message_id").notNull().unique(),
  messageIdHeader: text("message_id_header"),
  inReplyToHeader: text("in_reply_to_header"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  // Set on outbound messages the workflow sent. The send node checks for an
  // existing row with this id before calling the transport, so a retried job
  // cannot email the customer twice.
  approvalId: uuid("approval_id"),
});

export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketMessageId: uuid("ticket_message_id")
    .notNull()
    .references(() => ticketMessages.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  providerAttachmentId: text("provider_attachment_id"),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
});

export const kbSourceTypeEnum = pgEnum("kb_source_type", [
  "article",
]);

export const kbStatusEnum = pgEnum("kb_status", [
  "pending",
  "processing",
  "ready",
  "failed",
]);

export const kbEntries = pgTable(
  "kb_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    sourceType: kbSourceTypeEnum("source_type").notNull(),
    status: kbStatusEnum("status").notNull().default("pending"),
    errorMessage: text("error_message"),
    uploadedByUserId: text("uploaded_by_user_id").references(() => user.id),
    contentHash: text("content_hash"),
    embeddingModel: text("embedding_model"),
    tags: text("tags").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("kb_entries_tags_idx").using("gin", table.tags)]
);

const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

// Dimensions match Azure OpenAI's text-embedding-3-small; revisit if the
// embedding model changes in the AI Response Pipeline phase.
export const kbChunks = pgTable(
  "kb_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kbEntryId: uuid("kb_entry_id")
      .notNull()
      .references(() => kbEntries.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    chunkText: text("chunk_text").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('english', chunk_text)`
    ),
  },
  (table) => [
    index("kb_chunks_search_vector_idx").using("gin", table.searchVector),
    index("kb_chunks_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
    index("kb_chunks_entry_idx").on(table.kbEntryId),
  ]
);

// The graph's node set is fixed in code, so the key is an enum rather than
// free text — an agent row that no node reads would be dead configuration.
export const agentKeyEnum = pgEnum("agent_key", [
  "drafter",
  "info_requester",
  "router",
  "triage",
  "manual_writer",
]);

export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: agentKeyEnum("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  // Null falls back to the active "chat" deployment, so an agent stays
  // runnable before an admin has pinned it to a specific model.
  aiDeploymentId: uuid("ai_deployment_id").references(() => aiDeployments.id),
  temperature: numeric("temperature").notNull().default("0.2"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const agentPromptVersions = pgTable(
  "agent_prompt_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    version: integer("version").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    // Null on the seeded version 1 rows — no user exists when the migration
    // that inserts them runs.
    updatedByUserId: text("updated_by_user_id").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Same one-row-per-key trick as ai_deployments_one_active_per_role: the
    // database refuses two active prompts for one agent even if the advisory
    // lock in lib/agents/prompts.ts is ever bypassed.
    uniqueIndex("agent_prompt_versions_one_active_per_agent")
      .on(table.agentId)
      .where(sql`${table.isActive} = true`),
    index("agent_prompt_versions_agent_id_idx").on(table.agentId),
  ]
);

export const llmLogs = pgTable("llm_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id").references(() => tickets.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  response: text("response").notNull(),
  model: text("model").notNull(),
  agentId: uuid("agent_id").references(() => agents.id),
  graphThreadId: text("graph_thread_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// OAuth app credentials, encrypted with APP_ENCRYPTION_KEY (see
// lib/secrets/crypto.ts). Keeps third-party client secrets out of .env.
export const appSecrets = pgTable("app_secrets", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  encryptedValue: text("encrypted_value").notNull(),
  updatedByUserId: text("updated_by_user_id")
    .notNull()
    .references(() => user.id),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const aiDeploymentRoleEnum = pgEnum("ai_deployment_role", [
  "chat",
  "embedding",
]);

// Deployments are rows rather than fixed secret keys so an admin can add a new
// model from the UI without a schema change — see the AI Provider settings page.
export const aiDeployments = pgTable(
  "ai_deployments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    role: aiDeploymentRoleEnum("role").notNull(),
    deploymentName: text("deployment_name").notNull(),
    modelName: text("model_name").notNull(),
    // Required for the embedding role; the vector column's width depends on it.
    dimensions: integer("dimensions"),
    isActive: boolean("is_active").notNull().default(true),
    updatedByUserId: text("updated_by_user_id")
      .notNull()
      .references(() => user.id),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Same one-row-per-key trick used elsewhere (see agent_prompt_versions_one_active_per_agent):
    // the database itself refuses two active deployments for one role, backstopping the
    // advisory lock in lib/ai/config.ts.
    uniqueIndex("ai_deployments_one_active_per_role")
      .on(table.role)
      .where(sql`${table.isActive} = true`),
  ]
);

export const approvalKindEnum = pgEnum("approval_kind", [
  "send_email",
  "triage_out",
  "escalate",
  "close",
]);
export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "decided",
  "superseded",
]);
export const approvalDecisionEnum = pgEnum("approval_decision", [
  "approve",
  "edit",
  "reject_feedback",
  "override",
  "take_over",
]);

export const ticketApprovals = pgTable(
  "ticket_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    graphThreadId: text("graph_thread_id").notNull(),
    kind: approvalKindEnum("kind").notNull(),
    // Shaped per kind — see the spec's "What proposal holds, per kind".
    proposal: jsonb("proposal").notNull(),
    confidence: numeric("confidence").notNull(),
    status: approvalStatusEnum("status").notNull().default("pending"),
    decision: approvalDecisionEnum("decision"),
    editedBody: text("edited_body"),
    feedback: text("feedback"),
    overrideAction: text("override_action"),
    // Null when the gate auto-approved.
    decidedByUserId: text("decided_by_user_id").references(() => user.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    // "approval_disabled" or "above_confidence_floor". Auto-approvals still
    // write a row — without one there is no answer to "why did that go out?".
    autoApprovedReason: text("auto_approved_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A run can be suspended on at most one thing at a time, enforced by the
    // database rather than by the graph remembering to check.
    uniqueIndex("ticket_approvals_one_pending_per_thread")
      .on(table.graphThreadId)
      .where(sql`${table.status} = 'pending'`),
    index("ticket_approvals_ticket_id_idx").on(table.ticketId),
  ]
);

// Governs the system's autonomy rather than any one agent's behavior, which
// is why it is separate from `agents`. The row's id is random, not fixed —
// what actually keeps this a singleton is workflow_settings_singleton below.
export const workflowSettings = pgTable(
  "workflow_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Master kill switch: stops new runs without touching agent configuration.
    isEnabled: boolean("is_enabled").notNull().default(true),
    requireApproval: boolean("require_approval").notNull().default(true),
    // Only meaningful when requireApproval is false.
    autoSendMinConfidence: numeric("auto_send_min_confidence").notNull().default("0.8"),
    updatedByUserId: text("updated_by_user_id").references(() => user.id),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  () => [
    // A unique index on a constant expression: every row indexes to the same
    // value, so Postgres refuses a second one. This is what makes
    // updateWorkflowSettings's unfiltered UPDATE actually safe — without it,
    // "the table holds exactly one row" would be a comment, not a guarantee.
    uniqueIndex("workflow_settings_singleton").on(sql`(true)`),
  ]
);

export const sendAttemptStatusEnum = pgEnum("send_attempt_status", [
  "sending",
  "sent",
  "failed",
]);

// A claim, not a log. sendNode inserts this row BEFORE calling the mail
// transport, and the unique constraint on approval_id means a second
// attempt at the same approval loses the insert instead of quietly
// proceeding — that is what makes a duplicate customer email structurally
// impossible rather than merely unlikely. A row stuck at "sending" (the
// process died between the transport accepting the message and this row
// being updated) or "failed" is deliberately not retried automatically;
// it is what a human reviewing the ticket sees instead of silence.
export const ticketSendAttempts = pgTable("ticket_send_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Cascades so a deleted ticket does not leave an orphaned claim row behind
  // to trip up an unrelated cleanup elsewhere (e.g. a test or an admin
  // action that deletes a ticket outright) with a foreign key violation.
  ticketId: uuid("ticket_id")
    .notNull()
    .references(() => tickets.id, { onDelete: "cascade" }),
  // No foreign key to ticket_approvals, matching ticket_messages.approvalId
  // above — kept a loosely-typed reference rather than an enforced one so a
  // unit test can exercise the claim without needing a real approval row.
  approvalId: uuid("approval_id").notNull().unique(),
  status: sendAttemptStatusEnum("status").notNull().default("sending"),
  providerMessageId: text("provider_message_id"),
  messageIdHeader: text("message_id_header"),
  // Populated on failure so the ticket can show why nothing went out
  // without anyone digging through logs.
  errorText: text("error_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
