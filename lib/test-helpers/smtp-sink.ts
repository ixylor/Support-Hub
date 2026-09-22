import { SMTPServer } from "smtp-server";
import type { AddressInfo } from "node:net";

export interface CapturedMail {
  raw: string;
  from: string;
  to: string[];
}

export interface SmtpSink {
  port: number;
  messages: CapturedMail[];
  close(): Promise<void>;
}

export async function startSmtpSink(): Promise<SmtpSink> {
  const messages: CapturedMail[] = [];

  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    // The sink accepts any credentials — it stands in for a relay that
    // doesn't require real authentication, not for testing auth failures.
    onAuth(auth, _session, callback) {
      callback(null, { user: auth.username ?? "anonymous" });
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        messages.push({
          raw: Buffer.concat(chunks).toString("utf8"),
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "",
          to: session.envelope.rcptTo.map((recipient) => recipient.address),
        });
        callback();
      });
    },
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.server.address() as AddressInfo).port;

  return {
    port,
    messages,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
