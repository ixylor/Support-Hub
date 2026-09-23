"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePassword } from "@/lib/auth/client";

export default function AccountPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword.length < 8) {
      setMessage("Use at least 8 characters for your new password.");
      return;
    }
    if (currentPassword === newPassword) {
      setMessage("Your new password must be different from the current password.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
      if (result.error) {
        setMessage(result.error.message ?? "Could not change your password.");
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setMessage("Password changed. Other sessions were signed out.");
    } catch {
      setMessage("Could not change your password. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="mx-auto w-full max-w-2xl"><p className="text-xs text-muted-foreground">Account</p><h1 className="mt-1 text-xl font-semibold tracking-tight">My account</h1><p className="mt-1 text-sm text-muted-foreground">Keep your sign-in secure.</p><Card className="mt-6"><CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="size-4 text-primary" /> Change password</CardTitle><CardDescription>Use at least 8 characters. Other active sessions will be signed out.</CardDescription></CardHeader><CardContent><form className="flex max-w-md flex-col gap-4" onSubmit={submit}><div className="flex flex-col gap-1.5"><Label htmlFor="current-password">Current password</Label><Input id="current-password" type="password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></div><div className="flex flex-col gap-1.5"><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" minLength={8} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></div><Button disabled={busy} type="submit">{busy ? "Updating…" : "Change password"}</Button>{message ? <p className="text-sm text-muted-foreground">{message}</p> : null}</form></CardContent></Card></div>;
}
