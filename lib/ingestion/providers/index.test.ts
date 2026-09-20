import { describe, expect, it } from "vitest";
import { getMailProvider } from "./index";
import { microsoftGraphProvider } from "./microsoft-graph";
import { googleWorkspaceProvider } from "./google-workspace";

describe("mail provider registry", () => {
  it("resolves microsoft to the Graph provider", () => {
    expect(getMailProvider("microsoft")).toBe(microsoftGraphProvider);
  });

  it("resolves google to the Gmail provider", () => {
    expect(getMailProvider("google")).toBe(googleWorkspaceProvider);
  });
});
