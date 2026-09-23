"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bot, Cable, Inbox, Mail, SlidersHorizontal, BookOpen, UsersRound, UserCog } from "lucide-react";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const agentLinks = [
  { href: "/dashboard/tickets", label: "Tickets", icon: Inbox },
  { href: "/dashboard/settings/account", label: "My account", icon: UserCog },
];
const adminOnlyLinks = [
  { href: "/dashboard/knowledge-base", label: "Knowledge Base", icon: BookOpen },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/dashboard/settings/agents", label: "Agents", icon: SlidersHorizontal },
  { href: "/dashboard/settings/integrations", label: "Integrations", icon: Cable },
  { href: "/dashboard/settings/ai-provider", label: "AI Provider", icon: Bot },
  { href: "/dashboard/settings/email", label: "Email", icon: Mail },
  { href: "/dashboard/settings/users", label: "Users", icon: UsersRound },
];

export function Nav({ role }: { role: "agent" | "admin" }) {
  const links = role === "admin" ? [...agentLinks, ...adminOnlyLinks] : agentLinks;
  const pathname = usePathname();

  return (
    <SidebarMenu>
      {links.map((link) => {
        // Nested routes (e.g. /dashboard/settings/integrations/new) should still
        // highlight their parent nav entry.
        const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
        const Icon = link.icon;
        return (
          <SidebarMenuItem key={link.href}>
            <SidebarMenuButton isActive={isActive} tooltip={link.label} render={<Link href={link.href} />}>
              <Icon />
              <span>{link.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}
