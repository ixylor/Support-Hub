export interface OutboundMessage {
  to: string;
  subject: string;
  bodyText: string;
  // Provider-native conversation id when the mailbox supports it (Gmail).
  threadId?: string | null;
  // Provider-native message id to reply to (Microsoft Graph).
  replyToProviderMessageId?: string | null;
  // The Message-ID of the message being replied to, or null for a new thread.
  inReplyTo: string | null;
  // The full References chain, oldest first.
  references: string[];
}

export interface SentMessage {
  messageIdHeader: string | null;
  // Provider id used for local message deduplication and audit records.
  providerMessageId: string;
}

export interface MailTransport {
  send(message: OutboundMessage): Promise<SentMessage>;
  // Proves the configuration works before a customer ticket depends on it.
  // Every transport must implement it — the settings page calls it directly.
  verify(): Promise<void>;
}
