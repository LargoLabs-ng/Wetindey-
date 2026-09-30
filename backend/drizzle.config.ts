import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "drizzle-kit";

/**
 * Next.js loads .env.local automatically; drizzle-kit does not. Reading it
 * here means `npx drizzle-kit push` just works instead of needing the
 * connection string pasted onto the command line every time.
 */
function loadEnvLocal(): Record<string, string> {
  try {
    // Next uses frontend/ as its project root, so its .env.local belongs there.
    // Keep the database tools on the same environment file.
    const raw = readFileSync(path.join(process.cwd(), "frontend", ".env.local"), "utf8");
    const out: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      out[trimmed.slice(0, eq).trim()] = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

const env = { ...loadEnvLocal(), ...process.env };
const raw = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL || "";

/**
 * Migrations must go through Neon's DIRECT endpoint, not the pooled one.
 * The pooled host runs PgBouncer in transaction mode, where drizzle-kit's
 * introspection hangs forever on "Pulling schema from database..." and then
 * exits without a word. The direct host is the same name minus "-pooler";
 * channel_binding also trips up the migration driver, so it comes off too.
 */
const url = raw
  .replace("-pooler", "")
  .replace(/[?&]channel_binding=[^&]*/, "");

if (!url) {
  throw new Error(
    "No DATABASE_URL found — check frontend/.env.local."
  );
}

export default defineConfig({
  // Drizzle Kit resolves these relative to the workspace command directory.
  // Relative paths avoid its Windows absolute-path glob resolution bug.
  schema: "./backend/db/schema.ts",
  out: "./backend/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
});
