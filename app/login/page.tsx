"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/branding/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { signIn } from "@/lib/auth/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleEmailSignIn(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const result = await signIn.email({ email, password });
    if (result.error) {
      setError(result.error.message ?? "Unable to sign in.");
      return;
    }

    router.push("/dashboard");
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-muted/30 p-4 sm:p-6">
      <div className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 -bottom-24 size-72 rounded-full bg-primary/10 blur-3xl" />
      <Card className="relative w-full max-w-md">
        <CardHeader className="gap-4 border-b pb-6 text-center">
          <Logo size="lg" className="justify-center text-primary" />
          <div>
            <CardTitle className="text-xl">Welcome back</CardTitle>
            <CardDescription className="mt-1">Sign in to your support workspace.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-6">
          <form className="flex flex-col gap-4" onSubmit={handleEmailSignIn}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit">Sign in</Button>
          </form>
          <Button
            type="button"
            variant="outline"
            onClick={() => signIn.social({ provider: "google", callbackURL: "/dashboard" })}
          >
            Continue with Google
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
