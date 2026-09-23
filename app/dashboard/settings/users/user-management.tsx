"use client";

import { Fragment, useState } from "react";
import { KeyRound, LoaderCircle, Plus, UserRound, UsersRound, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ManagedUser = { id: string; name: string; email: string; role: string; createdAt: string };
type ApiPayload = { error?: string; user?: Partial<ManagedUser> };

export function UserManagement({ initialUsers }: { initialUsers: ManagedUser[] }) {
  const [users, setUsers] = useState(initialUsers);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "agent" });
  const [editing, setEditing] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"default" | "destructive">("default");

  function showMessage(text: string, tone: "default" | "destructive" = "default") {
    setMessage(text);
    setMessageTone(tone);
  }

  async function request(method: "POST" | "PATCH", body: Record<string, unknown>) {
    const response = await fetch("/api/users", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as ApiPayload | null;
    if (!response.ok) throw new Error(payload?.error ?? "Request failed.");
    return payload;
  }

  async function createUser(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const payload = await request("POST", form);
      if (payload?.user?.id && payload.user.name && payload.user.email) {
        const createdUser: ManagedUser = {
          id: payload.user.id,
          name: payload.user.name,
          email: payload.user.email,
          role: payload.user.role ?? form.role,
          createdAt: new Date().toISOString(),
        };
        setUsers((current) => [createdUser, ...current]);
      }
      setForm({ name: "", email: "", password: "", role: "agent" });
      showMessage("User created. They can sign in with the credentials you provided.");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "Could not create user.", "destructive");
    } finally {
      setBusy(false);
    }
  }

  async function updateUser(userId: string, role: string | null) {
    if (!role) return;
    setBusy(true);
    setMessage(null);
    try {
      await request("PATCH", { userId, role });
      setUsers((current) => current.map((item) => (item.id === userId ? { ...item, role } : item)));
      showMessage("Role updated.");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "Could not update role.", "destructive");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(userId: string) {
    if (password.length < 8) {
      showMessage("Use at least 8 characters for a password.", "destructive");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await request("PATCH", { userId, password });
      setPassword("");
      setEditing(null);
      showMessage("Password reset. The user can sign in with the new password.");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "Could not reset password.", "destructive");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div>
        <p className="text-xs text-muted-foreground">Administration</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">Add teammates, manage access, and reset credentials.</p>
      </div>

      {message ? (
        <Alert variant={messageTone} aria-live="polite">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UsersRound className="size-4 text-primary" /> Team members
            </CardTitle>
            <CardDescription>Only admins can change roles or reset passwords.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((item) => (
                  <Fragment key={item.id}>
                    <TableRow>
                      <TableCell className="min-w-56">
                        <div className="flex items-center gap-3">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                            <UserRound className="size-4 text-muted-foreground" />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{item.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{item.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge variant={item.role === "admin" ? "default" : "secondary"}>{item.role}</Badge>
                          <Select value={item.role} onValueChange={(value) => updateUser(item.id, value)} disabled={busy}>
                            <SelectTrigger aria-label={`Role for ${item.name}`} size="sm" className="w-24">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="agent">Agent</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Reset password for ${item.name}`}
                          onClick={() => {
                            setEditing(item.id);
                            setPassword("");
                          }}
                          disabled={busy}
                        >
                          <KeyRound />
                        </Button>
                      </TableCell>
                    </TableRow>
                    {editing === item.id ? (
                      <TableRow>
                      <TableCell colSpan={3} className="bg-muted/30">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <Label htmlFor={`reset-password-${item.id}`} className="sr-only">
                            New password for {item.name}
                          </Label>
                          <Input
                            id={`reset-password-${item.id}`}
                            autoFocus
                            type="password"
                            minLength={8}
                            placeholder="New password (8+ characters)"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            className="sm:max-w-xs"
                          />
                          <Button size="sm" disabled={busy} onClick={() => resetPassword(item.id)}>
                            {busy ? <LoaderCircle className="animate-spin" /> : <KeyRound />}
                            Save password
                          </Button>
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(null)}>
                            <X /> Cancel
                          </Button>
                        </div>
                      </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="size-4 text-primary" /> Add a teammate
            </CardTitle>
            <CardDescription>Create an account with a temporary password.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-3" onSubmit={createUser}>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="user-name">Name</Label>
                <Input id="user-name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="user-email">Email</Label>
                <Input id="user-email" type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="user-password">Temporary password</Label>
                <Input id="user-password" type="password" minLength={8} required value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="user-role">Role</Label>
                <Select value={form.role} onValueChange={(value) => value && setForm({ ...form, role: value })}>
                  <SelectTrigger id="user-role" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agent">Agent</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button disabled={busy} type="submit">
                {busy ? <LoaderCircle className="animate-spin" /> : <Plus />}
                Create user
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
