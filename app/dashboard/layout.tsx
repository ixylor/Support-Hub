import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { Logo } from "@/components/branding/logo";
import { Nav } from "@/components/dashboard/nav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  const role = (session.user as { role: "agent" | "admin" }).role;

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r p-4">
        <div className="pb-6">
          <Logo />
        </div>
        <Nav role={role} />
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
