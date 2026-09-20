import { describe, expect, it } from "vitest";
import { splitQuotedContent } from "./quote-trim";

describe("splitQuotedContent", () => {
  it("returns a plain message with no quoting untouched", () => {
    const body = [
      "Hi team,",
      "",
      "Just checking in on the status of ticket #482. Any update would be",
      "appreciated, we have a customer waiting on this.",
      "",
      "Thanks,",
      "Alex",
    ].join("\n");

    expect(splitQuotedContent(body)).toEqual({ visible: body, quoted: null });
  });

  it("collapses '>' prefixed quoted lines (single level)", () => {
    const body = [
      "Yes, that worked — thank you!",
      "",
      "> Hi Alex,",
      ">",
      "> Have you tried clearing your browser cache and logging in again?",
      "> Let us know if that resolves it.",
      ">",
      "> Best,",
      "> Support Team",
    ].join("\n");

    const result = splitQuotedContent(body);

    expect(result.visible).toBe("Yes, that worked — thank you!");
    expect(result.quoted).toContain("Have you tried clearing your browser cache");
  });

  it("collapses nested multi-level '>' quoting", () => {
    const body = [
      "Adding one more detail before you look into this.",
      "",
      "> > Original question from the customer",
      "> Response from support",
      "> > Follow-up from the customer",
    ].join("\n");

    const result = splitQuotedContent(body);

    expect(result.visible).toBe("Adding one more detail before you look into this.");
    expect(result.quoted).toContain("Original question from the customer");
  });

  it("collapses an 'On <date>, <someone> wrote:' attribution and everything after it", () => {
    const body = [
      "Thanks so much, that resolved it completely.",
      "",
      "On Wed, Jan 15, 2025 at 2:03 PM John Doe <john@example.com> wrote:",
      "> Hi there,",
      ">",
      "> Have you tried restarting the app? That usually fixes this issue",
      "> for most of our customers.",
      ">",
      "> Thanks,",
      "> John",
    ].join("\n");

    const result = splitQuotedContent(body);

    expect(result.visible).toBe("Thanks so much, that resolved it completely.");
    expect(result.quoted?.startsWith("On Wed, Jan 15, 2025")).toBe(true);
    expect(result.quoted).toContain("Have you tried restarting the app");
  });

  it("collapses Outlook's '-----Original Message-----' separator and the block below it", () => {
    const body = [
      "Sure, I will check on this today and get back to you.",
      "",
      "-----Original Message-----",
      "From: Jane Smith <jane@example.com>",
      "Sent: Monday, January 13, 2025 9:15 AM",
      "To: Support <support@example.com>",
      "Subject: Re: Issue with login",
      "",
      "Can you look into this? I have been unable to log in since yesterday",
      "and it is blocking my whole team.",
    ].join("\n");

    const result = splitQuotedContent(body);

    expect(result.visible).toBe("Sure, I will check on this today and get back to you.");
    expect(result.quoted?.startsWith("-----Original Message-----")).toBe(true);
    expect(result.quoted).toContain("blocking my whole team");
  });

  it("collapses an Outlook/Exchange header block even without the separator line", () => {
    const body = [
      "Following up on this — see the original request below.",
      "",
      "From: Jane Smith <jane@example.com>",
      "Sent: Monday, January 13, 2025 9:15 AM",
      "To: Support <support@example.com>",
      "Subject: Re: Issue with login",
      "",
      "Can you look into this? It has been down all morning and several",
      "people on my team are affected.",
    ].join("\n");

    const result = splitQuotedContent(body);

    expect(result.visible).toBe("Following up on this — see the original request below.");
    expect(result.quoted?.startsWith("From: Jane Smith")).toBe(true);
    expect(result.quoted).toContain("down all morning");
  });

  it("collapses a trailing signature delimited by a '-- ' line", () => {
    const body = [
      "Please cancel my subscription effective immediately, and let me know",
      "once it has gone through.",
      "",
      "-- ",
      "Alex Rivera",
      "Head of Operations, Rivera Consulting",
      "+1 555-0100",
    ].join("\n");

    const result = splitQuotedContent(body);

    expect(result.visible).toBe(
      "Please cancel my subscription effective immediately, and let me know\nonce it has gone through."
    );
    expect(result.quoted?.startsWith("-- ")).toBe(true);
    expect(result.quoted).toContain("Head of Operations");
  });

  it("does not collapse to an empty body when the entire message is quoted (a bare forward)", () => {
    const body = [
      "On Fri, Jan 10, 2025 at 9:00 AM Original Sender <orig@example.com> wrote:",
      "> This is the entire content of a forwarded message with no new text",
      "> added by whoever forwarded it along.",
      ">",
      "> It should still be visible somewhere rather than vanishing.",
    ].join("\n");

    const result = splitQuotedContent(body);

    expect(result.visible).toBe(body);
    expect(result.quoted).toBeNull();
  });

  it("does not collapse when only blank lines precede the quoted portion", () => {
    const body = ["", "  ", "> Only quoted content, no real message body above it."].join("\n");

    const result = splitQuotedContent(body);

    expect(result.visible).toBe(body);
    expect(result.quoted).toBeNull();
  });

  it("handles a realistic multi-paragraph reply with a quote block and a signature", () => {
    const body = [
      "Hi Support,",
      "",
      "Thanks for the quick response. I tried the steps you suggested and",
      "the export now completes without errors. Appreciate the help!",
      "",
      "-- ",
      "Priya Shah",
      "",
      "On Tue, Feb 4, 2025 at 11:20 AM Support <support@example.com> wrote:",
      "> Hi Priya,",
      ">",
      "> Can you try re-running the export after clearing the cached report",
      "> definitions? That has resolved this for other customers.",
      ">",
      "> Best,",
      "> Support Team",
    ].join("\n");

    const result = splitQuotedContent(body);

    expect(result.visible).toBe(
      "Hi Support,\n\nThanks for the quick response. I tried the steps you suggested and\nthe export now completes without errors. Appreciate the help!"
    );
    // The signature line is the earliest cut point in this body.
    expect(result.quoted?.startsWith("-- ")).toBe(true);
    expect(result.quoted).toContain("On Tue, Feb 4, 2025");
    expect(result.quoted).toContain("clearing the cached report");
  });
});
