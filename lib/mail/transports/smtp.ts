import nodemailer from "nodemailer";
import type { ActiveTransport } from "../config";
import type { MailTransport, OutboundMessage, SentMessage } from "../transport";

export function createSmtpTransport(transport: ActiveTransport): MailTransport {
  const { config, password } = transport;

  const client = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    // When the connection isn't already wrapped in implicit TLS, require the
    // server to upgrade via STARTTLS before we authenticate. Without this,
    // nodemailer will happily send AUTH in the clear if the server doesn't
    // advertise STARTTLS (or a middlebox strips it from the greeting).
    requireTLS: !config.secure,
    // A sink or a relay on a trusted network needs no credentials; sending
    // an empty user/pass pair makes nodemailer attempt AUTH and fail.
    auth: config.username ? { user: config.username, pass: password } : undefined,
  });

  return {
    async send(message: OutboundMessage): Promise<SentMessage> {
      const info = await client.sendMail({
        from: { name: config.fromName, address: config.fromAddress },
        to: message.to,
        subject: message.subject,
        text: message.bodyText,
        inReplyTo: message.inReplyTo ?? undefined,
        references: message.references.length ? message.references : undefined,
      });

      // nodemailer generates the Message-ID and reports it back. Persisting
      // the value it actually sent — rather than one we generate separately —
      // is what makes the customer's reply match our stored header.
      return { messageIdHeader: info.messageId, providerMessageId: info.messageId };
    },

    async verify(): Promise<void> {
      await client.verify();
    },
  };
}
