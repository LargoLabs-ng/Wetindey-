// Diagnostic: figure out why drizzle-kit dies at "Pulling schema".
// Run with:  npm run db:diagnose
import { readFileSync } from "node:fs";
import postgres from "postgres";

const env = {};
for (const line of readFileSync("frontend/.env.local", "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

const pooled = env.DATABASE_URL || "";
const direct = pooled.replace("-pooler", "").replace(/[?&]channel_binding=[^&]*/, "");

async function tryOne(label, url) {
  if (!url) return console.log(`${label}: no URL`);
  console.log(`\n--- ${label} ---`);
  console.log("host:", new URL(url).hostname);
  const started = Date.now();
  const sql = postgres(url, { max: 1, prepare: false, ssl: "require", connect_timeout: 20 });
  try {
    const rows = await sql`select current_database() as db, version() as v`;
    console.log("OK in", Date.now() - started, "ms —", rows[0].db);
    const t = await sql`select table_name from information_schema.tables where table_schema='public' order by 1`;
    console.log("tables:", t.map((r) => r.table_name).join(", "));
    console.log("event_staff exists:", t.some((r) => r.table_name === "event_staff"));
  } catch (e) {
    console.log("FAILED after", Date.now() - started, "ms");
    console.log("  name :", e.name);
    console.log("  code :", e.code);
    console.log("  msg  :", e.message);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

await tryOne("DIRECT (what drizzle-kit now uses)", direct);
await tryOne("POOLED (what the app uses)", pooled);
process.exit(0);
