import { getActiveTransport, MailNotConfiguredError, type MailTransportKind } from "../config";
import type { ActiveTransport } from "../config";
import type { MailTransport } from "../transport";
import { createSmtpTransport } from "./smtp";
import { getActiveMailboxConnection } from "@/lib/mailbox/connection";
import { createGoogleWorkspaceTransport } from "./google-workspace";

const FACTORIES: Record<MailTransportKind, (transport: ActiveTransport) => MailTransport> = {
  smtp: createSmtpTransport,
};

export async function getMailTransport(): Promise<MailTransport> {
  const mailbox = await getActiveMailboxConnection();
  if (mailbox?.provider === "google") {
    return createGoogleWorkspaceTransport();
  }

  const active = await getActiveTransport();
  if (!active) {
    throw new MailNotConfiguredError();
  }
  return FACTORIES[active.kind](active);
}
