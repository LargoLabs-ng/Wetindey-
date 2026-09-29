import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // Database-backed tests talk to Neon; give them room.
    testTimeout: 30_000,
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
