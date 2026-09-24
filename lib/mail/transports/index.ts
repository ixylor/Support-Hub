import type { MailTransport } from "../transport";
import { getActiveMailboxConnection } from "@/lib/mailbox/connection";
import { createGoogleWorkspaceTransport } from "./google-workspace";
import { createMicrosoftGraphTransport } from "./microsoft-graph";

export async function getMailTransport(): Promise<MailTransport> {
  const mailbox = await getActiveMailboxConnection();
  if (mailbox?.provider === "google") {
    return createGoogleWorkspaceTransport();
  }
  if (mailbox?.provider === "microsoft") return createMicrosoftGraphTransport();
  throw new Error("Connect a Google Workspace or Microsoft 365 mailbox before sending replies.");
}
