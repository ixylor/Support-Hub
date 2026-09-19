import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Nav } from "./nav";

describe("Nav", () => {
  it("shows Tickets for an agent but not Knowledge Base or Analytics", () => {
    render(<Nav role="agent" />);
    expect(screen.getByRole("link", { name: "Tickets" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Knowledge Base" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Analytics" })).not.toBeInTheDocument();
  });

  it("shows every link for an admin", () => {
    render(<Nav role="admin" />);
    expect(screen.getByRole("link", { name: "Tickets" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Knowledge Base" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Analytics" })).toBeInTheDocument();
  });
});
