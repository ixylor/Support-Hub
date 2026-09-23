import type { AttachmentRef, MailProvider, OAuthTokens, ProviderMessage } from "../provider";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send";

function getAuthorizationUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function exchangeCodeForTokens(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string
): Promise<OAuthTokens> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!response.ok) {
    throw new Error(`Google token exchange failed: ${response.status}`);
  }
  const { refresh_token, access_token } = (await response.json()) as {
    refresh_token: string;
    access_token: string;
  };

  const profileResponse = await fetch(`${GMAIL_BASE}/profile`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!profileResponse.ok) {
    throw new Error(`Google profile lookup failed: ${profileResponse.status}`);
  }
  const profile = (await profileResponse.json()) as { emailAddress: string };

  return { refreshToken: refresh_token, mailboxAddress: profile.emailAddress };
}

async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!response.ok) {
    throw new Error(`Google token refresh failed: ${response.status}`);
  }
  const { access_token } = (await response.json()) as { access_token: string };
  return access_token;
}

interface GmailPart {
  mimeType: string;
  filename?: string;
  body: { data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

function findTextPart(parts: GmailPart[]): GmailPart | null {
  for (const part of parts) {
    if (part.mimeType === "text/plain" && part.body.data) {
      return part;
    }
    if (part.parts) {
      const nested = findTextPart(part.parts);
      if (nested) return nested;
    }
  }
  return null;
}

function collectAttachments(parts: GmailPart[]): AttachmentRef[] {
  const attachments: AttachmentRef[] = [];
  for (const part of parts) {
    if (part.filename && part.body.attachmentId) {
      attachments.push({ id: part.body.attachmentId, filename: part.filename, contentType: part.mimeType });
    }
    if (part.parts) {
      attachments.push(...collectAttachments(part.parts));
    }
  }
  return attachments;
}

function headerValue(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function extractEmailAddress(fromHeader: string): string {
  const match = fromHeader.match(/<([^>]+)>/);
  return match ? match[1] : fromHeader.trim();
}

async function fetchFullMessage(accessToken: string, id: string): Promise<ProviderMessage> {
  const response = await fetch(`${GMAIL_BASE}/messages/${encodeURIComponent(id)}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Gmail message fetch failed: ${response.status}`);
  }
  const data = (await response.json()) as {
    id: string;
    threadId: string;
    internalDate: string;
    snippet: string;
    payload: { headers: Array<{ name: string; value: string }>; parts?: GmailPart[] };
  };

  const parts = data.payload.parts ?? [];
  const textPart = findTextPart(parts);
  const bodyText = textPart?.body.data
    ? Buffer.from(textPart.body.data, "base64url").toString("utf8")
    : data.snippet;

  return {
    providerMessageId: data.id,
    providerThreadId: data.threadId,
    senderEmail: extractEmailAddress(headerValue(data.payload.headers, "From")),
    subject: headerValue(data.payload.headers, "Subject"),
    bodyText,
    sentAt: new Date(Number(data.internalDate)),
    attachments: collectAttachments(parts),
    messageIdHeader: headerValue(data.payload.headers, "Message-ID") || null,
    inReplyToHeader: headerValue(data.payload.headers, "In-Reply-To") || null,
    referencesHeader: headerValue(data.payload.headers, "References") || null,
  };
}

// `connectMailbox` stores a cursor at connection time, so `getNewMessages` should
// only ever see a real timestamp in normal operation - there is no backfill of mail
// that predates the connection. A null cursor is kept only as a defensive fallback
// for a row created before that change existed. Treat it as "now": Gmail's `after:`
// filter takes whole-day epoch seconds and treats `after:0` as matching nothing
// (confirmed against a live mailbox), so falling back to epoch there would silently
// drop the first sync forever. Falling back to "now" instead means no historical
// backfill, matching the intended behaviour.
async function getNewMessages(accessToken: string, cursor: string | null) {
  const afterSeconds = Math.floor(new Date(cursor ?? new Date()).getTime() / 1000);
  const query = encodeURIComponent(`in:inbox after:${afterSeconds}`);
  const response = await fetch(`${GMAIL_BASE}/messages?q=${query}&maxResults=50`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Gmail message list failed: ${response.status}`);
  }
  const data = (await response.json()) as { messages?: Array<{ id: string }> };

  const messages: ProviderMessage[] = [];
  for (const item of data.messages ?? []) {
    messages.push(await fetchFullMessage(accessToken, item.id));
  }

  // Gmail's list endpoint returns newest-first. Sort ascending so this provider
  // matches the ordering contract the caller relies on (Microsoft's provider
  // already returns oldest-first via $orderby=receivedDateTime asc): the cron
  // route advances its cursor past the longest run of consecutive successes
  // from the start of the batch, which only skips exactly what it already
  // ingested when messages arrive in chronological order.
  messages.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());

  const nextCursor =
    messages.length > 0
      ? messages[messages.length - 1].sentAt.toISOString()
      : (cursor ?? new Date(0).toISOString());

  return { messages, nextCursor };
}

async function downloadAttachment(
  accessToken: string,
  providerMessageId: string,
  attachment: AttachmentRef
): Promise<Buffer> {
  const response = await fetch(
    `${GMAIL_BASE}/messages/${encodeURIComponent(providerMessageId)}/attachments/${encodeURIComponent(attachment.id)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) {
    throw new Error(`Gmail attachment download failed: ${response.status}`);
  }
  const data = (await response.json()) as { data: string };
  return Buffer.from(data.data, "base64url");
}

export const googleWorkspaceProvider: MailProvider = {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  getNewMessages,
  downloadAttachment,
};
