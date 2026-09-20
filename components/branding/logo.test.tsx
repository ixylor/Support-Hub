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

  it("exposes an accessible name but no wordmark text in mark-only mode", () => {
    render(<Logo variant="mark" />);
    expect(screen.getByRole("img", { name: "Support Hub" })).toBeInTheDocument();
    expect(screen.queryByText("Support Hub")).not.toBeInTheDocument();
  });
});
