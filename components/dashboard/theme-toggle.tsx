"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { isThemeValue, type ThemeValue } from "@/lib/theme";

function systemPrefersDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme: ThemeValue) {
  const dark = theme === "dark" || (theme === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
}

/**
 * A three-way Light / Dark / System control. Self-contained: it carries its
 * own state and persistence, so it can be mounted anywhere — the dashboard
 * header today, a dropdown menu later — without adapting to its container.
 */
export function ThemeToggle({
  defaultTheme = "system",
  className,
}: {
  defaultTheme?: ThemeValue;
  className?: string;
}) {
  const [theme, setTheme] = useState<ThemeValue>(defaultTheme);

  function selectTheme(next: ThemeValue) {
    setTheme(next);
    // Update <html> now rather than waiting on the request round trip.
    applyTheme(next);

    fetch("/api/theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: next }),
    }).catch(() => {
      // Best-effort persistence: this tab already reflects the choice; a
      // failed write only means it won't survive a fresh page load.
    });
  }

  return (
    <ToggleGroup
      value={[theme]}
      onValueChange={(values) => {
        const next = values[0];
        if (isThemeValue(next)) selectTheme(next);
      }}
      variant="outline"
      size="sm"
      spacing={0}
      aria-label="Theme"
      className={className}
    >
      <ToggleGroupItem value="light" aria-label="Light theme" title="Light">
        <Sun />
        <span className="sr-only">Light</span>
      </ToggleGroupItem>
      <ToggleGroupItem value="dark" aria-label="Dark theme" title="Dark">
        <Moon />
        <span className="sr-only">Dark</span>
      </ToggleGroupItem>
      <ToggleGroupItem value="system" aria-label="System theme" title="System">
        <Monitor />
        <span className="sr-only">System</span>
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
