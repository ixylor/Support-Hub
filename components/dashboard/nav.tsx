import Link from "next/link";

const agentLinks = [{ href: "/dashboard/tickets", label: "Tickets" }];
const adminOnlyLinks = [
  { href: "/dashboard/knowledge-base", label: "Knowledge Base" },
  { href: "/dashboard/analytics", label: "Analytics" },
  { href: "/dashboard/settings/prompts", label: "Prompt Settings" },
  // Integrations link returns in the Ticket Ingestion phase, once the
  // Microsoft Graph mailbox connection it configures actually exists.
];

export function Nav({ role }: { role: "agent" | "admin" }) {
  const links = role === "admin" ? [...agentLinks, ...adminOnlyLinks] : agentLinks;

  return (
    <nav className="flex flex-col gap-1">
      {links.map((link) => (
        <Link key={link.href} href={link.href} className="rounded-md px-3 py-2 text-sm hover:bg-accent">
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
