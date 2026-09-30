import fs from "node:fs";
import path from "node:path";

/**
 * Load .env.local the way Next does, so database-backed tests can reach the
 * same Neon instance the dev server uses. Values already in the environment
 * win, which is what makes CI overrides work.
 */
const file = path.resolve(process.cwd(), "frontend", ".env.local");
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}
