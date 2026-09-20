import type { MailboxProvider } from "./connection";

export const MAILBOX_OAUTH_PROVIDERS: readonly MailboxProvider[] = ["microsoft", "google"];

export function clientIdSecretKey(provider: MailboxProvider): string {
  return `mailbox_oauth_${provider}_client_id`;
}

export function clientSecretSecretKey(provider: MailboxProvider): string {
  return `mailbox_oauth_${provider}_client_secret`;
}
