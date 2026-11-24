/**
 * Ticket type order on a REAL database: a change to one tier must not move
 * it. Skipped unless NOTIFICATIONS_DB_TEST_URL points at a throwaway database.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const URL = process.env.NOTIFICATIONS_DB_TEST_URL;

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const schema = await import("../db/schema");
  const client = postgres(process.env.NOTIFICATIONS_DB_TEST_URL ?? "postgres://unused@127.0.0.1:1/x", {
    max: 2,
    prepare: false,
  });
  return { db: drizzle(client, { schema }), __client: client };
});

describe.skipIf(!URL)("ticket type order on a real database", () => {
  let sql: import("postgres").Sql;
  let db: typeof import("../db").db;
  let order: typeof import("./ticket-type-order");
  let schema: typeof import("../db/schema");
  let owner: string, org: string, event: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const mod = (await import("@/db")) as unknown as { __client: import("postgres").Sql; db: typeof db };
    sql = mod.__client;
    db = mod.db;
    order = await import("./ticket-type-order");
    schema = await import("../db/schema");
    const [u] = await sql`INSERT INTO users (email) VALUES (${`order-${randomUUID()}@example.test`}) RETURNING id`;
    owner = u.id;
    const [o] = await sql`INSERT INTO organizations (name, slug, owner_id) VALUES ('Order Org', ${"o-" + randomUUID()}, ${owner}) RETURNING id`;
    org = o.id;
    const [e] = await sql`INSERT INTO events (organization_id, title, slug, start_datetime, end_datetime, status)
                          VALUES (${org}, 'Order Night', ${"o-" + randomUUID()}, now() + interval '7 days', now() + interval '8 days', 'published')
                          RETURNING id`;
    event = e.id;
    // Created deliberately out of order.
    for (const [name, price] of [["VIP", 10000], ["Regular", 3000], ["Free RSVP", 0], ["early bird", 3000], ["VVIP", 25000]] as const) {
      const [t] = await sql`INSERT INTO ticket_types (event_id, name, price, quantity_total) VALUES (${event}, ${name}, ${price}, 50) RETURNING id`;
      ids[name] = t.id;
    }
  });

  afterAll(async () => {
    await sql`DELETE FROM ticket_types WHERE event_id = ${event}`;
    await sql`DELETE FROM events WHERE id = ${event}`;
    await sql`DELETE FROM organizations WHERE id = ${org}`;
    await sql`DELETE FROM users WHERE id = ${owner}`;
  });

  const expected = ["Free RSVP", "early bird", "Regular", "VIP", "VVIP"];

  async function viaSelect() {
    const { eq } = await import("drizzle-orm");
    const rows = await db
      .select({ name: schema.ticketTypes.name })
      .from(schema.ticketTypes)
      .where(eq(schema.ticketTypes.eventId, event))
      .orderBy(...order.ticketTypeOrder());
    return rows.map((r) => r.name);
  }

  async function viaRelation() {
    const { eq } = await import("drizzle-orm");
    const row = await db.query.events.findFirst({
      where: eq(schema.events.id, event),
      with: { ticketTypes: { orderBy: (t) => order.ticketTypeOrder(t) } },
    });
    return row!.ticketTypes.map((t) => t.name);
  }

  it("lists cheapest first, then by name ignoring capitals", async () => {
    expect(await viaSelect()).toEqual(expected);
    expect(await viaRelation()).toEqual(expected);
  });

  it("keeps the same order after a tier is edited", async () => {
    // Editing a row is what used to move it to the top.
    await sql`UPDATE ticket_types SET max_per_order = 3 WHERE id = ${ids.VIP}`;
    await sql`UPDATE ticket_types SET description = 'Front row' WHERE id = ${ids["Free RSVP"]}`;
    expect(await viaSelect()).toEqual(expected);
    expect(await viaRelation()).toEqual(expected);
  });
});
