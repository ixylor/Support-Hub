// Shared between the server (app/layout.tsx, the theme route handler) and the
// client (ThemeToggle, the anti-flash inline script), so the cookie name and
// the set of valid values only exist in one place.

export const THEME_COOKIE_NAME = "theme";

export const THEME_VALUES = ["light", "dark", "system"] as const;

export type ThemeValue = (typeof THEME_VALUES)[number];

export function isThemeValue(value: unknown): value is ThemeValue {
  return typeof value === "string" && (THEME_VALUES as readonly string[]).includes(value);
}

// One year: long enough that a returning visitor's choice survives, short
// enough to eventually pick up a browser-level cookie policy change.
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The script text run inline in the document head, before first paint.
 *
 * It resolves the effective theme (light/dark) from the `theme` cookie and,
 * for `system` or a missing cookie, from `prefers-color-scheme`, then applies
 * it as a class on `<html>`. This runs synchronously ahead of the rest of the
 * page so there is no flash of the wrong theme.
 *
 * It also keeps the `system` case live: if the cookie names no explicit
 * choice, it subscribes to OS theme changes for as long as the page stays
 * open, so switching desktop appearance is reflected without a reload.
 *
 * Kept minimal and wrapped in try/catch since it must never throw and block
 * rendering — matchMedia and document.cookie are ordinary DOM/CSS-OM APIs,
 * not APIs that can be told not to run.
 */
export const THEME_INLINE_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )theme=([^;]*)/);var v=m?decodeURIComponent(m[1]):"system";var q=window.matchMedia("(prefers-color-scheme: dark)");var apply=function(){var dark=v==="dark"||(v!=="light"&&q.matches);document.documentElement.classList.toggle("dark",dark);};apply();if(v!=="light"&&v!=="dark"){q.addEventListener("change",apply);}}catch(e){}})();`;
