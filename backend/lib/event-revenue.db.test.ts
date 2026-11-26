/**
 * Promoter sales on a REAL database.
 * Skipped unless NOTIFICATIONS_DB_TEST_URL points at a throwaway database.
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

describe.skipIf(!URL)("promoterSales on a real database", () => {
  let sql: import("postgres").Sql;
  let revenue: typeof import("./event-revenue");
  const users: Record<string, string> = {};
  let org: string, event: string, tier: string;

  async function order(promoter: string | null, qty: number, subtotal: number, opts: { status?: string; refunded?: number } = {}) {
    const [o] = await sql`
      INSERT INTO orders (event_id, email, phone, subtotal, fees, total, status, platform_fee_paid_by, promoter_id)
      VALUES (${event}, 'buyer@example.test', '0800', ${subtotal}, 0, ${subtotal + 77.5}, ${opts.status ?? "paid"}, 'organizer', ${promoter})
      RETURNING id`;
    for (let i = 0; i < qty; i += 1) {
      const status = i < (opts.refunded ?? 0) ? "refunded" : "valid";
      await sql`INSERT INTO tickets (order_id, event_id, ticket_type_id, attendee_name, attendee_email, qr_token, status)
                VALUES (${o.id}, ${event}, ${tier}, 'Buyer', 'buyer@example.test', ${randomUUID()}, ${status})`;
    }
  }

  beforeAll(async () => {
    const mod = (await import("@/db")) as unknown as { __client: import("postgres").Sql };
    sql = mod.__client;
    revenue = await import("./event-revenue");
    for (const name of ["owner", "ada", "bayo", "chidi"]) {
      const [u] = await sql`INSERT INTO users (email, first_name) VALUES (${`${name}-${randomUUID()}@example.test`}, ${name}) RETURNING id`;
      users[name] = u.id;
    }
    const [o] = await sql`INSERT INTO organizations (name, slug, owner_id) VALUES ('Promo Org', ${"p-" + randomUUID()}, ${users.owner}) RETURNING id`;
    org = o.id;
    const [e] = await sql`INSERT INTO events (organization_id, title, slug, start_datetime, end_datetime, status)
                          VALUES (${org}, 'Promo Night', ${"p-" + randomUUID()}, now() + interval '7 days', now() + interval '8 days', 'published')
                          RETURNING id`;
    event = e.id;
    const [t] = await sql`INSERT INTO ticket_types (event_id, name, price, quantity_total) VALUES (${event}, 'Regular', 1500, 100) RETURNING id`;
    tier = t.id;
    for (const [name, code] of [["ada", "ADA1"], ["bayo", "BAYO1"], ["chidi", "CHIDI1"]]) {
      await sql`INSERT INTO event_staff (event_id, user_id, user_email, role, status, ref_code)
                VALUES (${event}, ${users[name]}, ${name + "@example.test"}, 'promoter', 'active', ${code + randomUUID().slice(0, 6)})`;
    }

    await order(users.ada, 2, 3000); // one order, two tickets: ₦3,000, not ₦6,000
    await order(users.ada, 1, 1500);
    await order(users.ada, 1, 1500, { status: "pending" }); // unpaid: ignored
    await order(users.bayo, 3, 4500, { refunded: 1 }); // one of three refunded
    await order(null, 4, 6000); // no promoter: nobody's
  });

  afterAll(async () => {
    await sql`DELETE FROM tickets WHERE event_id = ${event}`;
    await sql`DELETE FROM orders WHERE event_id = ${event}`;
    await sql`DELETE FROM event_staff WHERE event_id = ${event}`;
    await sql`DELETE FROM ticket_types WHERE event_id = ${event}`;
    await sql`DELETE FROM events WHERE id = ${event}`;
    await sql`DELETE FROM organizations WHERE id = ${org}`;
    await sql`DELETE FROM users WHERE id IN ${sql(Object.values(users))}`;
  });

  it("counts each order once, drops refunds and unpaid orders, and keeps promoters with no sales", async () => {
    const rows = await revenue.promoterSales(event);
    const by = Object.fromEntries(rows.map((r) => [r.firstName, { sold: r.sold, faceValue: r.faceValue }]));
    expect(by).toEqual({
      ada: { sold: 3, faceValue: 4500 },
      bayo: { sold: 2, faceValue: 3000 },
      chidi: { sold: 0, faceValue: 0 },
    });
    expect(rows.map((r) => r.firstName)).toEqual(["ada", "bayo", "chidi"]);
  });

  it("gives a promoter the same figures on their own page, and zero for a cancelled event", async () => {
    const mine = await revenue.salesForPromoter(users.ada, [event]);
    expect(mine.get(event)).toEqual({ sold: 3, faceValue: 4500 });

    const bayo = await revenue.salesForPromoter(users.bayo, [event]);
    expect(bayo.get(event)).toEqual({ sold: 2, faceValue: 3000 });

    // No sales: no entry, which the page shows as 0.
    expect((await revenue.salesForPromoter(users.chidi, [event])).has(event)).toBe(false);
    expect((await revenue.salesForPromoter(users.ada, [])).size).toBe(0);

    // Cancelling an event voids its tickets.
    const voided = await sql`UPDATE tickets SET status = 'cancelled' WHERE event_id = ${event} AND status = 'valid' RETURNING id`;
    try {
      expect((await revenue.salesForPromoter(users.ada, [event])).get(event)).toEqual({ sold: 0, faceValue: 0 });
    } finally {
      await sql`UPDATE tickets SET status = 'valid' WHERE id IN ${sql(voided.map((t) => t.id))}`;
    }
  });
});
