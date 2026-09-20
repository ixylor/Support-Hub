import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { Logo } from "@/components/branding/logo";
import { Nav } from "@/components/dashboard/nav";
import { SignOutButton } from "@/components/dashboard/sign-out-button";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  const role = (session.user as { role: "agent" | "admin" }).role;

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r p-4">
        <div className="pb-6">
          <Logo />
        </div>
        <Nav role={role} />
        <div className="mt-auto border-t pt-4">
          <p className="truncate pb-2 text-xs text-muted-foreground" title={session.user.email}>
            {session.user.email}
          </p>
          <SignOutButton />
        </div>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
