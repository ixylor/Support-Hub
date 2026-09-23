"use client";

import { ChevronDownIcon, PaperclipIcon } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { splitQuotedContent } from "@/lib/tickets/quote-trim";

// Content types safe to render as an inline <img> preview. Kept in sync
// with the inline allowlist the attachment route enforces server-side —
// this list only controls whether we *try* an <img>, the route decides
// what actually gets served inline.
const PREVIEWABLE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

export type MessageListAttachment = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

export type MessageListItem = {
  id: string;
  direction: "inbound" | "outbound";
  senderEmail: string;
  body: string;
  sentAtLabel: string;
  attachments: MessageListAttachment[];
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentItem({ attachment }: { attachment: MessageListAttachment }) {
  const href = `/api/attachments/${attachment.id}`;
  const mimeType = attachment.contentType.split(";")[0]?.trim().toLowerCase() ?? "";

  if (PREVIEWABLE_IMAGE_TYPES.has(mimeType)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="block w-fit">
        {/* eslint-disable-next-line @next/next/no-img-element -- attacker-controlled remote-ish content served from our own route, not an optimizable local asset */}
        <img
          src={href}
          alt={attachment.filename}
          className="max-h-40 max-w-60 rounded-none border object-contain"
        />
        <span className="mt-1 block text-xs text-muted-foreground">
          {attachment.filename} ({formatBytes(attachment.sizeBytes)})
        </span>
      </a>
    );
  }

  return (
    <a
      href={href}
      className="flex items-center gap-1.5 text-sm text-foreground underline underline-offset-2 hover:text-primary"
    >
      <PaperclipIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span>
        {attachment.filename} <span className="text-muted-foreground">({formatBytes(attachment.sizeBytes)})</span>
      </span>
    </a>
  );
}

function MessageBody({ body }: { body: string }) {
  const { visible, quoted } = splitQuotedContent(body);

  if (!quoted) {
    return <p className="whitespace-pre-wrap text-sm">{visible}</p>;
  }

  return (
    <div>
      <p className="whitespace-pre-wrap text-sm">{visible}</p>
      <Collapsible>
        <CollapsibleTrigger className="group mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronDownIcon className="size-3 transition-transform group-data-[state=open]:rotate-180" />
          Show quoted text
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="mt-2 whitespace-pre-wrap border-l-2 pl-3 text-sm text-muted-foreground">
            {quoted}
          </p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export function MessageList({ messages }: { messages: MessageListItem[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Email thread</h2>
          <p className="text-xs text-muted-foreground">{messages.length} message{messages.length === 1 ? "" : "s"}</p>
        </div>
      </div>
      {messages.map((message) => (
        <Card key={message.id} className={message.direction === "outbound" ? "border-primary/25 bg-primary/[.03]" : ""}>
          <CardHeader className="grid-cols-[1fr_auto] items-baseline">
            <div className="min-w-0">
              <span className="font-medium">{message.direction === "outbound" ? "Support" : message.senderEmail}</span>
              <span className="ml-2 text-xs text-muted-foreground">{message.direction === "outbound" ? "sent" : "received"}</span>
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">{message.sentAtLabel}</span>
          </CardHeader>
          <CardContent>
            <MessageBody body={message.body} />
            {message.attachments.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-2 border-t pt-3">
                {message.attachments.map((attachment) => (
                  <li key={attachment.id}>
                    <AttachmentItem attachment={attachment} />
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
