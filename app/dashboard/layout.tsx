import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { Logo } from "@/components/branding/logo";
import { Nav } from "@/components/dashboard/nav";
import { AccountDropdown } from "@/components/dashboard/account-dropdown";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { isThemeValue, THEME_COOKIE_NAME } from "@/lib/theme";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  const role = (session.user as { role: "agent" | "admin" }).role;
  const userName = session.user.name?.trim() || "User";
  const userEmail = session.user.email;
  const avatarInitials = userName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  // The vendored SidebarProvider persists open/collapsed state in this cookie
  // on toggle; reading it here lets the server render the correct state on
  // first paint instead of flashing expanded before collapsing.
  const sidebarState = (await cookies()).get("sidebar_state")?.value;
  const defaultOpen = sidebarState !== "false";

  // Same idea as sidebar_state: read the choice server-side so the toggle
  // renders already showing the right selection instead of flashing "system".
  const themeCookie = (await cookies()).get(THEME_COOKIE_NAME)?.value;
  const defaultTheme = isThemeValue(themeCookie) ? themeCookie : "system";

  return (
    <SidebarProvider defaultOpen={defaultOpen} className="h-svh overflow-hidden">
      <Sidebar collapsible="icon">
        <SidebarHeader className="overflow-hidden border-b px-3 py-4 group-data-[collapsible=icon]:px-1">
          {/* Swap to the mark-only logo at rail width so the wordmark never clips. */}
          <div className="flex items-center truncate group-data-[collapsible=icon]:justify-center">
            <Logo className="group-data-[collapsible=icon]:hidden" />
            <Logo variant="mark" className="hidden group-data-[collapsible=icon]:inline-flex" />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <Nav role={role} />
        </SidebarContent>
        <SidebarFooter className="border-t p-2 group-data-[collapsible=icon]:px-0">
          <AccountDropdown name={userName} email={userEmail} initials={avatarInitials} />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="h-svh overflow-hidden">
        <div className="flex h-full min-h-0 flex-col">
          <header className="flex shrink-0 items-center gap-3 border-b bg-background/95 px-3 py-2.5 backdrop-blur sm:px-5">
            <SidebarTrigger />
            <div className="flex min-w-0 items-center gap-2 md:hidden">
              <Logo size="sm" />
            </div>
            <ThemeToggle defaultTheme={defaultTheme} className="ml-auto" />
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto bg-muted/20 px-4 py-5 sm:px-6 sm:py-7 lg:px-8">{children}</main>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
