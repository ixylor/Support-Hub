export interface OutboundMessage {
  to: string;
  subject: string;
  bodyText: string;
  // The Message-ID of the message being replied to, or null for a new thread.
  inReplyTo: string | null;
  // The full References chain, oldest first.
  references: string[];
}

export interface SentMessage {
  messageIdHeader: string;
  // For SMTP these are the same value; other transports return a provider-
  // assigned id distinct from the RFC 5322 Message-ID.
  providerMessageId: string;
}

export interface MailTransport {
  send(message: OutboundMessage): Promise<SentMessage>;
  // Proves the configuration works before a customer ticket depends on it.
  // Every transport must implement it — the settings page calls it directly.
  verify(): Promise<void>;
}
