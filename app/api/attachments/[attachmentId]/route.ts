import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { attachments, ticketMessages, tickets } from "@/lib/db/schema";
import { attachmentsDir } from "@/lib/ingestion/attachment-storage";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Content types genuinely safe to render inline in the browser. Everything
// else — including image/svg+xml and text/html, both of which can carry
// script — is forced to download. An inline SVG/HTML attachment served from
// our own origin would otherwise be stored XSS against the dashboard.
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
  // A Route Handler's own request already carries the Cookie header, so we
  // read the session straight off it. Equivalent to the dashboard pages'
  // auth.api.getSession({ headers: await headers() }), but doesn't depend
  // on Next's internal request-scope storage, which keeps this handler
  // unit-testable by calling GET() directly.
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { attachmentId } = await params;
  if (!UUID_PATTERN.test(attachmentId)) {
    return notFound();
  }

  // Look the file up by id — never trust a client-supplied path. The joins
  // carry the parent ticket along so visibility is decided in the same
  // query, before any bytes are read off disk.
  const viewer = session.user as { id: string; role: string };
  const [attachment] = await db
    .select({
      filename: attachments.filename,
      storagePath: attachments.storagePath,
      contentType: attachments.contentType,
      assignedToUserId: tickets.assignedToUserId,
    })
    .from(attachments)
    .innerJoin(ticketMessages, eq(ticketMessages.id, attachments.ticketMessageId))
    .innerJoin(tickets, eq(tickets.id, ticketMessages.ticketId))
    .where(
      // Same rule as lib/tickets/queries.ts: admins reach every ticket,
      // agents only the ones assigned to them. Without this an agent could
      // pull attachments off a ticket they cannot open.
      viewer.role === "admin"
        ? eq(attachments.id, attachmentId)
        : and(eq(attachments.id, attachmentId), eq(tickets.assignedToUserId, viewer.id))
    );
  if (!attachment) {
    return notFound();
  }

  // Re-validate containment on read rather than trusting storagePath as
  // stored: resolve it and confirm it is still inside the configured
  // attachments directory, the same check attachment-storage.ts makes on
  // write.
  const baseDir = resolve(attachmentsDir());
  const resolvedPath = resolve(attachment.storagePath);
  const relativePath = relative(baseDir, resolvedPath);
  if (relativePath.startsWith("..") || relativePath === "" || relativePath === ".") {
    return notFound();
  }

  let fileBuffer: Buffer;
  try {
    fileBuffer = await readFile(resolvedPath);
  } catch {
    return notFound();
  }

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
}
