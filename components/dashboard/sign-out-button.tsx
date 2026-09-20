"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { signOut } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      // refresh() clears the cached server-rendered dashboard, so the layout's
      // session check runs again instead of serving the signed-in shell.
      router.replace("/login");
      router.refresh();
    } catch {
      setSigningOut(false);
    }
  }

  return (
    <Button variant="outline" size="sm" className="w-full" onClick={handleSignOut} disabled={signingOut}>
      {signingOut ? "Signing out..." : "Sign out"}
    </Button>
  );
}
