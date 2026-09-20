import type { AttachmentRef, MailProvider, OAuthTokens, ProviderMessage } from "../provider";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const AUTHORIZE_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const SCOPE = "offline_access Mail.Read";

function getAuthorizationUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: SCOPE,
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
      scope: SCOPE,
    }),
  });
  if (!response.ok) {
    throw new Error(`Microsoft token exchange failed: ${response.status}`);
  }
  const { refresh_token, access_token } = (await response.json()) as {
    refresh_token: string;
    access_token: string;
  };

  const profileResponse = await fetch(`${GRAPH_BASE}/me`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!profileResponse.ok) {
    throw new Error(`Microsoft profile lookup failed: ${profileResponse.status}`);
  }
  const profile = (await profileResponse.json()) as { mail?: string; userPrincipalName: string };

  return { refreshToken: refresh_token, mailboxAddress: profile.mail ?? profile.userPrincipalName };
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
      scope: SCOPE,
    }),
  });
  if (!response.ok) {
    throw new Error(`Microsoft token refresh failed: ${response.status}`);
  }
  const { access_token } = (await response.json()) as { access_token: string };
  return access_token;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

async function listAttachments(accessToken: string, messageId: string): Promise<AttachmentRef[]> {
  const response = await fetch(
    `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) {
    throw new Error(`Microsoft Graph attachment list failed: ${response.status}`);
  }
  const data = (await response.json()) as { value: Array<{ id: string; name: string; contentType: string }> };
  return data.value.map((item) => ({ id: item.id, filename: item.name, contentType: item.contentType }));
}

async function getNewMessages(accessToken: string, cursor: string | null) {
  const since = cursor ?? new Date(0).toISOString();
  const filter = encodeURIComponent(`receivedDateTime gt ${since}`);
  const url = `${GRAPH_BASE}/me/mailFolders/inbox/messages?$filter=${filter}&$orderby=receivedDateTime asc&$top=50&$select=id,conversationId,from,subject,body,receivedDateTime`;

  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    throw new Error(`Microsoft Graph message list failed: ${response.status}`);
  }
  const data = (await response.json()) as {
    value: Array<{
      id: string;
      conversationId: string;
      from: { emailAddress: { address: string } };
      subject: string;
      body: { content: string };
      receivedDateTime: string;
    }>;
  };

  const messages: ProviderMessage[] = [];
  for (const item of data.value) {
    messages.push({
      providerMessageId: item.id,
      providerThreadId: item.conversationId,
      senderEmail: item.from.emailAddress.address,
      subject: item.subject,
      bodyText: stripHtml(item.body.content),
      sentAt: new Date(item.receivedDateTime),
      attachments: await listAttachments(accessToken, item.id),
    });
  }

  const nextCursor = data.value.length > 0 ? data.value[data.value.length - 1].receivedDateTime : since;

  return { messages, nextCursor };
}

async function downloadAttachment(
  accessToken: string,
  providerMessageId: string,
  attachment: AttachmentRef
): Promise<Buffer> {
  const response = await fetch(
    `${GRAPH_BASE}/me/messages/${encodeURIComponent(providerMessageId)}/attachments/${encodeURIComponent(attachment.id)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) {
    throw new Error(`Microsoft Graph attachment download failed: ${response.status}`);
  }
  const data = (await response.json()) as { contentBytes: string };
  return Buffer.from(data.contentBytes, "base64");
}

export const microsoftGraphProvider: MailProvider = {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  getNewMessages,
  downloadAttachment,
};
