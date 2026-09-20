import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["node_modules", "dist", ".next", "e2e"],
    // mailbox_connections enforces a single active row across the whole
    // database (see mailbox_connections_one_active); running test files in
    // parallel against the shared test DB would let them race for that row.
    fileParallelism: false,
  },
});
