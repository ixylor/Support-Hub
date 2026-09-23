import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { Logo } from "@/components/branding/logo";
import { Nav } from "@/components/dashboard/nav";
import { SignOutButton } from "@/components/dashboard/sign-out-button";
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

  // The vendored SidebarProvider persists open/collapsed state in this cookie
  // on toggle; reading it here lets the server render the correct state on
  // first paint instead of flashing expanded before collapsing.
  const sidebarState = (await cookies()).get("sidebar_state")?.value;
  const defaultOpen = sidebarState !== "false";

  return (
    <SidebarProvider defaultOpen={defaultOpen} className="h-svh overflow-hidden">
      <Sidebar collapsible="icon">
        <SidebarHeader className="overflow-hidden border-b px-3 py-4">
          {/* Swap to the mark-only logo at rail width so the wordmark never clips. */}
          <div className="flex items-center truncate group-data-[collapsible=icon]:justify-center">
            <Logo className="group-data-[collapsible=icon]:hidden" />
            <Logo variant="mark" className="hidden group-data-[collapsible=icon]:inline-flex" />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <Nav role={role} />
        </SidebarContent>
        <SidebarFooter className="border-t">
          {/* Hidden in icon mode: at 3rem wide there's no room for the email
              or the full-width sign-out button without causing overflow. */}
          <div className="group-data-[collapsible=icon]:hidden">
            <p className="truncate px-2 text-xs text-muted-foreground" title={session.user.email}>
              {session.user.email}
            </p>
            <SignOutButton />
          </div>
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
            <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
              Press <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">⌘ B</kbd> to toggle sidebar
            </span>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto bg-muted/20 px-4 py-5 sm:px-6 sm:py-7 lg:px-8">{children}</main>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
