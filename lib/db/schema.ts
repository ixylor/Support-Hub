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
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "@/lib/auth/schema";

export const mailboxProviderEnum = pgEnum("mailbox_provider", ["microsoft"]);
export const mailboxStatusEnum = pgEnum("mailbox_status", [
  "active",
  "disconnected",
  "error",
]);

// A single shared team mailbox connected via Microsoft Graph OAuth.
// Not designed for per-agent mailboxes — see Foundation spec.
export const mailboxConnections = pgTable("mailbox_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: mailboxProviderEnum("provider").notNull(),
  mailboxAddress: text("mailbox_address").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  connectedByUserId: text("connected_by_user_id")
    .notNull()
    .references(() => user.id),
  status: mailboxStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const ticketStatusEnum = pgEnum("ticket_status", [
  "new",
  "pending_review",
  "approved",
  "escalated",
  "resolved",
  "waiting_on_customer",
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

export const tickets = pgTable("tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  subject: text("subject").notNull(),
  requesterEmail: text("requester_email").notNull(),
  status: ticketStatusEnum("status").notNull().default("new"),
  category: ticketCategoryEnum("category"),
  priority: ticketPriorityEnum("priority"),
  confidenceScore: numeric("confidence_score"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const messageDirectionEnum = pgEnum("message_direction", [
  "inbound",
  "outbound",
]);

export const ticketMessages = pgTable("ticket_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id")
    .notNull()
    .references(() => tickets.id),
  direction: messageDirectionEnum("direction").notNull(),
  senderEmail: text("sender_email").notNull(),
  body: text("body").notNull(),
  messageIdHeader: text("message_id_header"),
  inReplyToHeader: text("in_reply_to_header"),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
});

export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketMessageId: uuid("ticket_message_id")
    .notNull()
    .references(() => ticketMessages.id),
  filename: text("filename").notNull(),
  storagePath: text("storage_path").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
});

export const kbEntries = pgTable("kb_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Dimensions match Azure OpenAI's text-embedding-3-small; revisit if the
// embedding model changes in the AI Response Pipeline phase.
export const kbChunks = pgTable("kb_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  kbEntryId: uuid("kb_entry_id")
    .notNull()
    .references(() => kbEntries.id),
  chunkIndex: integer("chunk_index").notNull(),
  chunkText: text("chunk_text").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
});

export const promptTemplates = pgTable(
  "prompt_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    content: text("content").notNull(),
    version: integer("version").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    updatedByUserId: text("updated_by_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    // Backstops the advisory-lock serialization in activateNewPromptVersion:
    // even if that lock is ever bypassed, the DB itself can't hold two active
    // versions for the same key.
    uniqueIndex("prompt_templates_one_active_per_key")
      .on(table.key)
      .where(sql`${table.isActive} = true`),
  ]
);

export const ticketAiDrafts = pgTable("ticket_ai_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id")
    .notNull()
    .references(() => tickets.id),
  draftBody: text("draft_body").notNull(),
  citedKbChunkIds: uuid("cited_kb_chunk_ids").array().notNull().default([]),
  confidenceScore: numeric("confidence_score").notNull(),
  promptTemplateId: uuid("prompt_template_id")
    .notNull()
    .references(() => promptTemplates.id),
  // LangGraph checkpoint/thread reference, populated starting in the AI
  // Response Pipeline phase so an interrupted run can resume.
  graphThreadId: text("graph_thread_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const llmLogs = pgTable("llm_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id").references(() => tickets.id),
  prompt: text("prompt").notNull(),
  response: text("response").notNull(),
  model: text("model").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
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
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
