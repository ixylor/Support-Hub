import type { MailboxProvider } from "@/lib/mailbox/connection";
import type { MailProvider } from "../provider";
import { microsoftGraphProvider } from "./microsoft-graph";
import { googleWorkspaceProvider } from "./google-workspace";

const PROVIDERS: Record<MailboxProvider, MailProvider> = {
  microsoft: microsoftGraphProvider,
  google: googleWorkspaceProvider,
};

export function getMailProvider(provider: MailboxProvider): MailProvider {
  return PROVIDERS[provider];
}
