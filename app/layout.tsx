import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { THEME_COOKIE_NAME, THEME_INLINE_SCRIPT } from "@/lib/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Support Hub",
    template: "%s | Support Hub",
  },
  description: "A focused workspace for managing customer support.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Only "dark" can be resolved server-side; "system" (and no cookie yet)
  // depends on the OS preference, which the server can't see, so that case is
  // left for the inline script below to resolve before first paint.
  const theme = (await cookies()).get(THEME_COOKIE_NAME)?.value;
  const isDark = theme === "dark";

  return (
    <html
      lang="en"
      className={cn("h-full", "antialiased", geistSans.variable, geistMono.variable, {
        dark: isDark,
      })}
      // The inline script below may flip this class before React hydrates
      // (resolving "system"), which would otherwise trigger a hydration
      // mismatch warning for an attribute that's expected to change.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INLINE_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
