import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startSmtpSink, type SmtpSink } from "@/lib/test-helpers/smtp-sink";
import type { ActiveTransport } from "../config";
import { createSmtpTransport } from "./smtp";

let sink: SmtpSink;

function transportFor(sink: SmtpSink): ActiveTransport {
  return {
    id: "transport-1",
    kind: "smtp",
    name: "Sink",
    password: "unused",
    config: {
      host: "127.0.0.1",
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
