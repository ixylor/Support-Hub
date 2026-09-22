import { getActiveTransport, MailNotConfiguredError, type MailTransportKind } from "../config";
import type { ActiveTransport } from "../config";
import type { MailTransport } from "../transport";
import { createSmtpTransport } from "./smtp";

const FACTORIES: Record<MailTransportKind, (transport: ActiveTransport) => MailTransport> = {
  smtp: createSmtpTransport,
};

export async function getMailTransport(): Promise<MailTransport> {
  const active = await getActiveTransport();
  if (!active) {
    throw new MailNotConfiguredError();
  }
  return FACTORIES[active.kind](active);
}
