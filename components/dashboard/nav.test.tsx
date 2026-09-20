import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Nav } from "./nav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/tickets",
}));

// SidebarProvider's mobile detection reads matchMedia, which jsdom doesn't implement.
window.matchMedia ??= vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));

function renderNav(role: "agent" | "admin") {
  return render(
    <SidebarProvider>
      <Nav role={role} />
    </SidebarProvider>
  );
}

describe("Nav", () => {
  it("shows Tickets for an agent but not Knowledge Base or Analytics", () => {
    renderNav("agent");
    expect(screen.getByRole("link", { name: "Tickets" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Knowledge Base" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Analytics" })).not.toBeInTheDocument();
  });

  it("shows every link for an admin", () => {
    renderNav("admin");
    expect(screen.getByRole("link", { name: "Tickets" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Knowledge Base" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Analytics" })).toBeInTheDocument();
  });
});
