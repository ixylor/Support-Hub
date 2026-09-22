import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startSmtpSink, type SmtpSink } from "@/lib/test-helpers/smtp-sink";
import type { ActiveTransport } from "../config";
import { createSmtpTransport } from "./smtp";

let sink: SmtpSink;

// The sink presents a self-signed certificate (see smtp-sink.ts) so it can
// advertise STARTTLS the way requireTLS now demands. Node's TLS stack won't
// trust that certificate by default, and there is no production config knob
// for pinning a CA, so the test process is told to skip chain-of-trust
// verification for its own connections. This is strictly a test-runtime
// setting: it never reaches the production transport, which keeps verifying
// certificates normally.
let previousRejectUnauthorized: string | undefined;

beforeAll(() => {
  previousRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
});

afterAll(() => {
  if (previousRejectUnauthorized === undefined) {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  } else {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousRejectUnauthorized;
  }
});

function transportFor(sink: SmtpSink): ActiveTransport {
  return {
    id: "transport-1",
    kind: "smtp",
    name: "Sink",
    password: "unused",
    config: {
      // The sink's STARTTLS cert is issued for CN=localhost; connecting by
      // that name (rather than the loopback address) lets TLS hostname
      // verification succeed without weakening certificate checking.
      host: "localhost",
      port: sink.port,
      secure: false,
      username: "support@example.test",
      fromAddress: "support@example.test",
      fromName: "Example Support",
    },
  };
}

describe("smtp transport", () => {
  beforeEach(async () => {
    sink = await startSmtpSink();
  });

  afterEach(async () => {
    await sink.close();
  });

  it("sends a message from the configured address", async () => {
    const transport = createSmtpTransport(transportFor(sink));

    await transport.send({
      to: "customer@example.test",
      subject: "Re: Login is not working",
      bodyText: "Could you tell us the exact error message?",
      inReplyTo: null,
      references: [],
    });

    expect(sink.messages).toHaveLength(1);
    expect(sink.messages[0].to).toEqual(["customer@example.test"]);
    expect(sink.messages[0].raw).toContain("Could you tell us the exact error message?");
    expect(sink.messages[0].raw).toContain("Example Support");
  });

  it("sets In-Reply-To and References so the reply threads", async () => {
    const transport = createSmtpTransport(transportFor(sink));

    await transport.send({
      to: "customer@example.test",
      subject: "Re: Login is not working",
      bodyText: "Here is the fix.",
      inReplyTo: "<inbound-2@mail.example.test>",
      references: ["<inbound-1@mail.example.test>", "<inbound-2@mail.example.test>"],
    });

    const raw = sink.messages[0].raw;
    expect(raw).toContain("In-Reply-To: <inbound-2@mail.example.test>");
    expect(raw).toContain("<inbound-1@mail.example.test>");
    expect(raw).toContain("<inbound-2@mail.example.test>");
  });

  it("returns the Message-ID it actually sent", async () => {
    const transport = createSmtpTransport(transportFor(sink));

    const sent = await transport.send({
      to: "customer@example.test",
      subject: "Re: Login is not working",
      bodyText: "Here is the fix.",
      inReplyTo: null,
      references: [],
    });

    expect(sent.messageIdHeader).toMatch(/^<.+>$/);
    expect(sent.providerMessageId).toBe(sent.messageIdHeader);
    expect(sink.messages[0].raw).toContain(`Message-ID: ${sent.messageIdHeader}`);
  });

  it("verify succeeds against a reachable server", async () => {
    await expect(createSmtpTransport(transportFor(sink)).verify()).resolves.toBeUndefined();
  });

  it("verify fails against an unreachable server", async () => {
    const unreachable = transportFor(sink);
    await sink.close();

    await expect(createSmtpTransport(unreachable).verify()).rejects.toThrow();
  });
});
