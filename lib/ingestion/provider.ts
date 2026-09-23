export interface AttachmentRef {
  id: string;
  filename: string;
  contentType: string;
}

export interface ProviderMessage {
  providerMessageId: string;
  providerThreadId: string;
  senderEmail: string;
  subject: string;
  bodyText: string;
  sentAt: Date;
  attachments: AttachmentRef[];
  // RFC headers are needed when support sends a reply. Provider ids identify
  // the message to an API, but they do not create an email thread.
  messageIdHeader?: string | null;
  inReplyToHeader?: string | null;
  referencesHeader?: string | null;
}

export interface FetchMessagesResult {
  messages: ProviderMessage[];
  nextCursor: string;
}

export interface OAuthTokens {
  refreshToken: string;
  mailboxAddress: string;
}

export interface MailProvider {
  getAuthorizationUrl(clientId: string, redirectUri: string, state: string): string;
  exchangeCodeForTokens(
    clientId: string,
    clientSecret: string,
    code: string,
    redirectUri: string
  ): Promise<OAuthTokens>;
  refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string>;
  getNewMessages(accessToken: string, cursor: string | null): Promise<FetchMessagesResult>;
  downloadAttachment(
    accessToken: string,
    providerMessageId: string,
    attachment: AttachmentRef
  ): Promise<Buffer>;
}
