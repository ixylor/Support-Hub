import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges class names, dropping falsy values", () => {
    expect(cn("a", false, "b", undefined)).toBe("a b");
  });
});
