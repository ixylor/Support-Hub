import type { AttachmentRef, MailProvider, OAuthTokens, ProviderMessage } from "../provider";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

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
  const response = await fetch(`${GMAIL_BASE}/messages/${id}?format=full`, {
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
  };
}

async function getNewMessages(accessToken: string, cursor: string | null) {
  const afterSeconds = Math.floor(new Date(cursor ?? 0).getTime() / 1000);
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

  const nextCursor =
    messages.length > 0
      ? new Date(Math.max(...messages.map((message) => message.sentAt.getTime()))).toISOString()
      : (cursor ?? new Date(0).toISOString());

  return { messages, nextCursor };
}

async function downloadAttachment(
  accessToken: string,
  providerMessageId: string,
  attachment: AttachmentRef
): Promise<Buffer> {
  const response = await fetch(
    `${GMAIL_BASE}/messages/${providerMessageId}/attachments/${attachment.id}`,
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
