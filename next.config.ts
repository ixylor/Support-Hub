import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright's webServer sets NEXT_DIST_DIR so its spawned dev server
  // builds into a separate directory from the developer's own `pnpm dev`.
  // Next's dev server takes an exclusive lock inside distDir/lock — sharing
  // the default `.next` would make the two instances fight over that lock
  // (or the test run would just reuse whichever one already holds it,
  // silently pointing E2E at the developer's server and its database).
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
