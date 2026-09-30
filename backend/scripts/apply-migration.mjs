// Applies a migration SQL file against DATABASE_URL.
//
//   npm run db:migrate -- backend/migrations/0006_conversation.sql
//
// Why this and not drizzle-kit: `migrate` replays from a journal this
// project doesn't keep — earlier migrations were applied by hand — and
// `push` diffs the live database against schema.ts and decides for itself
// what to run. This runs exactly the SQL that was written and reviewed, and
// nothing else.
//
// Safe to run twice. Every statement in 0006 is IF NOT EXISTS or wrapped in
// a duplicate-object guard.
import { readFileSync } from "node:fs";
import postgres from "postgres";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run db:migrate -- <path-to.sql>");
  process.exit(1);
}

// Read frontend/.env.local the same way db-check.mjs does, so this works from a plain
// `node` invocation with no loader.
const env = {};
for (const line of readFileSync("frontend/.env.local", "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > 0) {
    env[t.slice(0, i).trim()] = t
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
}

const url = env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not found in frontend/.env.local");
  process.exit(1);
}

const sqlText = readFileSync(file, "utf8");

// One connection, and the whole file in a single call. postgres.js sends it
// as one simple query, so the DO blocks and their semicolons survive intact
// — splitting on ";" would cut them in half.
const sql = postgres(url, { max: 1, prepare: false, ssl: "require" });

try {
  console.log(`Applying ${file} …`);
  await sql.unsafe(sqlText);
  console.log("Done.");
} catch (error) {
  console.error("Failed:", error.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
