import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // Database-backed tests talk to Neon; give them room.
    testTimeout: 30_000,
    // When a real test database is configured, run test files one at a time:
    // several of them share it, and the notification worker in one file
    // would otherwise pick up rows another file is still asserting on.
    fileParallelism: !process.env.NOTIFICATIONS_DB_TEST_URL,
  },
  resolve: {
    alias: {
      "@/auth": path.resolve(__dirname, "./auth.ts"),
      "@/components": path.resolve(__dirname, "../frontend/components"),
      "@/db": path.resolve(__dirname, "./db"),
      "@/lib": path.resolve(__dirname, "./lib"),
      "@": path.resolve(__dirname, "../frontend/src"),
    },
  },
});
