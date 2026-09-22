import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { mailTransports } from "@/lib/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/secrets/crypto";

export class MailNotConfiguredError extends Error {
  constructor() {
    super("No mail transport is configured. Set one up under Settings → Email.");
    this.name = "MailNotConfiguredError";
  }
}

export type MailTransportKind = "smtp";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  fromAddress: string;
  fromName: string;
}

export interface TransportConfigRow {
  id: string;
  kind: MailTransportKind;
  name: string;
  config: SmtpConfig;
}

export interface ActiveTransport extends TransportConfigRow {
  password: string;
}

async function selectActiveRow() {
  const [row] = await db
    .select()
    .from(mailTransports)
    .where(eq(mailTransports.isActive, true))
    .limit(1);
  return row ?? null;
}

export async function getActiveTransportConfig(): Promise<TransportConfigRow | null> {
  const row = await selectActiveRow();
  if (!row) return null;

  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    config: row.config as SmtpConfig,
  };
}

export async function getActiveTransport(): Promise<ActiveTransport | null> {
  const row = await selectActiveRow();
  if (!row) return null;

  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    config: row.config as SmtpConfig,
    password: decryptSecret(row.encryptedPassword),
  };
}

export async function saveTransport(
  input: {
    kind: MailTransportKind;
    name: string;
    config: SmtpConfig;
    // Null means "keep the stored password" — the settings form is write-only
    // and never echoes it back, so an unchanged field arrives as null.
    password: string | null;
  },
  updatedByUserId: string
): Promise<void> {
  const existing = await selectActiveRow();

  if (input.password === null && !existing) {
    throw new Error("A password is required when configuring a transport for the first time.");
  }

  const encryptedPassword =
    input.password === null ? existing!.encryptedPassword : encryptSecret(input.password);

  if (existing) {
    await db
      .update(mailTransports)
      .set({
        kind: input.kind,
        name: input.name,
        config: input.config,
        encryptedPassword,
        updatedByUserId,
      })
      .where(eq(mailTransports.id, existing.id));
    return;
  }

  await db.insert(mailTransports).values({
    kind: input.kind,
    name: input.name,
    config: input.config,
    encryptedPassword,
    isActive: true,
    updatedByUserId,
  });
}
