import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Logo } from "./logo";

describe("Logo", () => {
  it("renders the app name", () => {
    render(<Logo />);
    expect(screen.getByText("Support Hub")).toBeInTheDocument();
  });

  it("applies a larger text size for the lg variant", () => {
    render(<Logo size="lg" />);
    expect(screen.getByText("Support Hub")).toHaveClass("text-2xl");
  });
});
