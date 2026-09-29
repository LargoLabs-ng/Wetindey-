import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// A single shared connection per serverless function instance.
//
// Deployment target: Vercel (serverless functions) + Neon (external Postgres).
// Neon's pooled connection string (the one ending in "-pooler" / using
// PgBouncer in transaction mode) does NOT support prepared statements, so
// `prepare: false` is required — without it, queries will intermittently
// fail in production even though everything works locally against a
// direct (non-pooled) connection. `max: 1` matches serverless reality:
// each function invocation gets its own short-lived process, so pooling
// belongs at the database layer (Neon's pooler), not in this client.
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Add it to your .env file.");
}

const client = postgres(connectionString, {
  max: 1,
  prepare: false,
  ssl: "require",
});

export const db = drizzle(client, { schema });
