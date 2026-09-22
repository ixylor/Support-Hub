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

// Self-signed, long-lived (2126) test-only certificate for CN=localhost so
// the sink can advertise STARTTLS. smtp-server ships its own default
// certificate for this purpose, but that one has since expired, so this sink
// carries its own rather than depending on an upstream package's fixture.
const TLS_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDrO6RJY/B/1CNw
NrNqgC3RtpDM6mNn1QwbxESUqg4HrW6IR2HLEWvGXJLEARAD2orkGAlaBBituz63
bmYTLEbapqQWXp/ygRfU8EULuuRjWKPVAhM/k27ndhfwCKQxFPaP8cqRvMHioTpC
1RT0ZDZCgkNBWZwRjkqBGNswJl7q9CRBBKj6Z2i/Im5flCX1jkSRrfjpaixM3fOU
O5A0G6rfuDY8YShcqSdTki2LaXXKOCtiMRPSpOUwu+07G5DENhDxqkhhvcFDS6A2
xw7SuKBMV8JN/O0MJ7Tn40sd9c0jDNCB3z0fuWJjRYjDgivBECxcDtzCXfgEOyOv
IsfidpcRAgMBAAECggEAIGPV+0UHmJJdTtY5XjDIHlhFF/IuPd3YDPq5dr7zr5rx
3VH25T9A189nZhW/Xsh412932i02OLXPrPJGm9085F6NuYbN/1ZHMcrjtvnE+Oj7
phjjDZ3/Z1+bbDHEaf249ZkVi3uyNsJ8gzdT61LhJcdJ+3WbR8+P8ra5d6fQ6gjw
XWxNXTO62z5HuG9cP1urZsroDDE1cdP3S9HvVq88qlt3eHqjyN31lQdLoJU2dD2Y
JY7pma1SPitoA3W6toRhshhqWeR59Ic+GZiLUCYBWaVDyRMIlJ15Xx93tinTRsYS
4PXL0u5STT0rPtXnu9VHVOtp/ElahcVFqFzCav0lAQKBgQD6F+VhPOHf97zFgdPG
yJjJVsoPkaDMn4kpjtOzYtUQf7InpzCOgCShzpl/5iuKbed135kEHAR7YKphanD4
iApSb+QOovWNtRGOgfxqzzFvDtiCjkVoxKNaiRxlnC/uMSIMpQTIiKRCDhQiwUMW
7PfyMs3wcp6YhbWrDY/9RCCdNwKBgQDwyeXIYOUUJ9GamtPBtVvB9/zosAjfl0bp
zNwy0GiM8JZYdOcs02Pie/tiEw/gMuU8ruBBZhb/RiZAC7zNcqomRDX8ZzZj3hRS
IuakrMuwV6K55TJ6E5m+Uy288zRa18eKeL/EOqciRjqwj9SupsoRBVFLaYZxOKBh
jKAaSQPR9wKBgHIvKtlklLRPRe7fQbPGrotuhr7o/IOwa02AGoQSobjwtISKPw8w
zojZ7ReKHWMMntsghZpsuFckYWYs1PuEEUJmN7e/C2Hxw9xO2NJjWuyb2JpzHpmg
/fw+EasKzo9v+13OkgqE6IoIJ4Veu6Th+KqqK4CWtHZqxfEdNhqqWkGtAoGBAKqh
yG4JDA0OcqCm2yzIQi/gdp7GMGOSJjSEcf6oZY6K51/j5/aCDqRuy6OicnukVYJ9
QnnVyLI5md2E89R7T0wyxjcJRSfcNnZGOT+1G9rpH22wl+aegTK4aw8dIZrGkqb0
DqEWF15YejqokkT5+PO62vMf4p/VSwIVz1cRKt3dAoGBAOVWUy/K7qvX36NHICLJ
56ZorToE5qda2jCjLZDO0ZUD64AGGZvPCo1zpCJNTCkIBgejf7NIMzTjsU3Og/Gx
wKfhQljqiuCmqynU39dIMOj7k7fF94PmDVHWnVxmI2lgSF47mdmc/eqpzk6jJ+71
CqBLS3nWSOXL9RnREz+2u3pH
-----END PRIVATE KEY-----`;

const TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIDLDCCAhSgAwIBAgIUOMKbMEm2Nw3uukCDDxIr9i4L62IwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MDkyMjAzMjA0M1oYDzIxMjYw
ODI5MDMyMDQzWjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQDrO6RJY/B/1CNwNrNqgC3RtpDM6mNn1QwbxESUqg4H
rW6IR2HLEWvGXJLEARAD2orkGAlaBBituz63bmYTLEbapqQWXp/ygRfU8EULuuRj
WKPVAhM/k27ndhfwCKQxFPaP8cqRvMHioTpC1RT0ZDZCgkNBWZwRjkqBGNswJl7q
9CRBBKj6Z2i/Im5flCX1jkSRrfjpaixM3fOUO5A0G6rfuDY8YShcqSdTki2LaXXK
OCtiMRPSpOUwu+07G5DENhDxqkhhvcFDS6A2xw7SuKBMV8JN/O0MJ7Tn40sd9c0j
DNCB3z0fuWJjRYjDgivBECxcDtzCXfgEOyOvIsfidpcRAgMBAAGjdDByMB0GA1Ud
DgQWBBRy2mBgl4onQWhGNdw+mAD93+6O7TAfBgNVHSMEGDAWgBRy2mBgl4onQWhG
Ndw+mAD93+6O7TAPBgNVHRMBAf8EBTADAQH/MB8GA1UdEQQYMBaCCWxvY2FsaG9z
dIIJMTI3LjAuMC4xMA0GCSqGSIb3DQEBCwUAA4IBAQChi8iNUA5W7DFW6aeKykqH
Jv0VIpDAF+yU8HaFGUWYTjV9z82xQIF18dOSOfVidNF+vhT/jcF4smb0/v/x2R5O
3nQ5L9b4arOyuevgrSyd1See5UsM8cxQe/w9SuNKjifc12YLlf6EhwHizssGRwkI
8TFoEMCKUdVf70aL99oCOm9LZCOL8hnGuCK3xNh6HjLqDQQfU+soXRpqFcltuMnW
OWhcWduR/1xW4dseV5KOzzFtv5pYDOvwAfX3vsP4OrUSmkwt7ZmqRpBeoVBtZ3zC
mNkGpOVjikB2cFvn036/w93mdXwk2e7locpSc/87JKbo4pgPMWOsZhC5FR6aF4ba
-----END CERTIFICATE-----`;

export async function startSmtpSink(): Promise<SmtpSink> {
  const messages: CapturedMail[] = [];

  const server = new SMTPServer({
    authOptional: true,
    key: TLS_KEY,
    cert: TLS_CERT,
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
