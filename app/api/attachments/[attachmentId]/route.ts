import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { attachments, mailboxConnections, ticketMessages, tickets } from "@/lib/db/schema";
import { getSecret } from "@/lib/secrets/store";
import { getDecryptedRefreshToken } from "@/lib/mailbox/connection";
import { clientIdSecretKey, clientSecretSecretKey } from "@/lib/mailbox/oauth-credentials";
import { getMailProvider } from "@/lib/ingestion/providers";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only these content types are safe to render inline. In particular, SVG and
// HTML files are downloaded to avoid serving active content from our origin.
const INLINE_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "application/pdf",
]);

function notFound(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ attachmentId: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { attachmentId } = await params;
  if (!UUID_PATTERN.test(attachmentId)) return notFound();

  const viewer = session.user as { id: string; role: string };
  const [attachment] = await db
    .select({
      filename: attachments.filename,
      providerAttachmentId: attachments.providerAttachmentId,
      contentType: attachments.contentType,
      sizeBytes: attachments.sizeBytes,
      providerMessageId: ticketMessages.providerMessageId,
      mailboxConnectionId: mailboxConnections.id,
      provider: mailboxConnections.provider,
    })
    .from(attachments)
    .innerJoin(ticketMessages, eq(ticketMessages.id, attachments.ticketMessageId))
    .innerJoin(tickets, eq(tickets.id, ticketMessages.ticketId))
    .innerJoin(mailboxConnections, eq(mailboxConnections.id, tickets.mailboxConnectionId))
    .where(
      viewer.role === "admin"
        ? eq(attachments.id, attachmentId)
        : and(eq(attachments.id, attachmentId), eq(tickets.assignedToUserId, viewer.id))
    );

  if (!attachment) return notFound();

  try {
    const clientId = await getSecret(clientIdSecretKey(attachment.provider));
    const clientSecret = await getSecret(clientSecretSecretKey(attachment.provider));
    if (!clientId || !clientSecret) {
      return NextResponse.json({ error: "Mailbox OAuth credentials are unavailable." }, { status: 503 });
    }

    const provider = getMailProvider(attachment.provider);
    const refreshToken = await getDecryptedRefreshToken(attachment.mailboxConnectionId);
    const accessToken = await provider.refreshAccessToken(clientId, clientSecret, refreshToken);
    let providerAttachmentId = attachment.providerAttachmentId;
    if (!providerAttachmentId) {
      // Backfill references for attachments ingested before live retrieval was
      // introduced, using the metadata already kept for attachment history.
      if (!provider.listAttachments) return notFound();
      const candidates = (await provider.listAttachments(accessToken, attachment.providerMessageId))
        .filter((candidate) => candidate.filename === attachment.filename)
        .filter((candidate) => candidate.contentType === attachment.contentType)
        .filter((candidate) => !attachment.sizeBytes || candidate.sizeBytes === attachment.sizeBytes);
      if (candidates.length !== 1) return notFound();
      providerAttachmentId = candidates[0].id;
      await db
        .update(attachments)
        .set({ providerAttachmentId })
        .where(eq(attachments.id, attachmentId));
    }

    const fileBuffer = await provider.downloadAttachment(accessToken, attachment.providerMessageId, {
      id: providerAttachmentId,
      filename: attachment.filename,
      contentType: attachment.contentType,
    });

    const mimeType = attachment.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
    const disposition = INLINE_CONTENT_TYPES.has(mimeType) ? "inline" : "attachment";
    const asciiFallbackName = attachment.filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
    const encodedFilename = encodeURIComponent(attachment.filename);

    return new Response(new Uint8Array(fileBuffer), {
      headers: {
        "Content-Type": attachment.contentType,
        "Content-Disposition": `${disposition}; filename="${asciiFallbackName}"; filename*=UTF-8''${encodedFilename}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Length": String(fileBuffer.byteLength),
        "Cache-Control": "private, max-age=0, no-cache",
      },
    });
  } catch (error) {
    console.error(`Live attachment fetch failed for ${attachmentId}:`, error);
    return NextResponse.json(
      { error: "The attachment could not be fetched from the mailbox." },
      { status: 502 }
    );
  }
}
