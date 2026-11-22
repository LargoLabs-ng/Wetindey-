/**
 * Order completion against a REAL Postgres database (notifications stage 2).
 *
 * Skipped unless NOTIFICATIONS_DB_TEST_URL points at a throwaway database
 * with the schema and migration 0025 applied. NEVER point it at production.
 *
 * Proves the promise of stage 2: completing an order — payment claimed,
 * order paid, tickets valid, seats sold, promo counted, notification event
 * recorded — is saved all together or not at all. A failure part-way leaves
 * nothing behind, and a retry then completes everything. That is the fix for
 * the old gap where a buyer could pay and be left with no valid ticket.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const URL = process.env.NOTIFICATIONS_DB_TEST_URL;

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const schema = await import("../db/schema");
  // TEST_DB_MAX=1 reproduces production (one connection per function): any
  // query inside the transaction that used the shared client instead of
  // `tx` would wait forever for a second connection.
  const client = postgres(process.env.NOTIFICATIONS_DB_TEST_URL ?? "postgres://unused@127.0.0.1:1/x", {
    max: Number(process.env.TEST_DB_MAX ?? 6),
    prepare: false,
  });
  return { db: drizzle(client, { schema }), __client: client };
});

// The ticket email isn't what's under test (and must never undo a purchase).
const emailed: string[] = [];
vi.mock("@/lib/ticket-email", () => ({
  sendTicketsForOrder: async (orderId: string) => {
    emailed.push(orderId);
  },
}));

// A switch to make the outbox write fail, to prove the rollback.
const inject = { outboxFails: false };
vi.mock("@/lib/notifications/outbox", async (importOriginal) => {
  const real = await importOriginal<typeof import("./notifications/outbox")>();
  return {
    ...real,
    recordEvent: async (...args: Parameters<typeof real.recordEvent>) => {
      if (inject.outboxFails) throw new Error("injected failure while recording the event");
      return real.recordEvent(...args);
    },
  };
});

describe.skipIf(!URL)("order completion is all-or-nothing", () => {
  let sql: import("postgres").Sql;
  let finalize: typeof import("./finalize-order");
  let sweep: typeof import("./notifications/sweep");
  let ids: { user: string; org: string; event: string; tier: string; promo: string };

  /** A pending checkout: order + tickets + held seats + an initialized payment. */
  async function seedCheckout(opts: { quantity?: number; free?: boolean; promo?: boolean } = {}) {
    const qty = opts.quantity ?? 1;
    const total = opts.free ? 0 : 1000 * qty;
    const [order] = await sql`
      INSERT INTO orders (event_id, email, phone, subtotal, fees, total, status,
                          platform_fee_paid_by, promo_code_id, reservation_expires_at)
      VALUES (${ids.event}, 'buyer@example.test', '0800', ${total}, 0, ${total}, 'pending',
              'organizer', ${opts.promo ? ids.promo : null}, now() + interval '15 minutes')
      RETURNING id`;
    for (let i = 0; i < qty; i += 1) {
      await sql`
        INSERT INTO tickets (order_id, event_id, ticket_type_id, attendee_name, attendee_email, qr_token, status)
        VALUES (${order.id}, ${ids.event}, ${ids.tier}, 'Buyer', 'buyer@example.test', ${randomUUID()}, 'pending')`;
    }
    await sql`UPDATE ticket_types SET quantity_reserved = quantity_reserved + ${qty} WHERE id = ${ids.tier}`;
    const reference = `WD-TEST-${randomUUID()}`;
    await sql`
      INSERT INTO payments (order_id, provider, provider_reference, amount, status)
      VALUES (${order.id}, ${opts.free ? "free" : "paystack"}, ${reference}, ${total},
              ${opts.free ? "success" : "initialized"})`;
    return { orderId: order.id as string, reference };
  }

  async function stateOf(orderId: string, reference: string) {
    const [o] = await sql`SELECT status FROM orders WHERE id = ${orderId}`;
    const [p] = await sql`SELECT status FROM payments WHERE provider_reference = ${reference}`;
    const t = await sql`SELECT status FROM tickets WHERE order_id = ${orderId}`;
    const [tier] = await sql`SELECT quantity_sold, quantity_reserved, status FROM ticket_types WHERE id = ${ids.tier}`;
    const [promo] = await sql`SELECT used_count FROM promo_codes WHERE id = ${ids.promo}`;
    const events = await sql`SELECT type, dedupe_key, payload FROM notification_events
                             WHERE dedupe_key IN (${`order.paid:${orderId}`}, ${`order.confirmed:${orderId}`})`;
    return {
      order: o.status,
      payment: p.status,
      tickets: t.map((r) => r.status),
      sold: tier.quantity_sold,
      reserved: tier.quantity_reserved,
      tierStatus: tier.status,
      promoUses: promo.used_count,
      events,
    };
  }

  beforeAll(async () => {
    const mod = (await import("@/db")) as unknown as { __client: import("postgres").Sql };
    sql = mod.__client;
    finalize = await import("./finalize-order");
    sweep = await import("./notifications/sweep");
    const [user] = await sql`INSERT INTO users (email, first_name, last_name)
                             VALUES (${`owner-${randomUUID()}@example.test`}, 'Test', 'Owner') RETURNING id`;
    const [org] = await sql`INSERT INTO organizations (name, slug, owner_id)
                            VALUES ('Stage 2 Org', ${"stage2-" + randomUUID()}, ${user.id}) RETURNING id`;
    const [event] = await sql`INSERT INTO events (organization_id, title, slug, start_datetime, end_datetime, status)
                              VALUES (${org.id}, 'Stage 2 Event', ${"stage2-" + randomUUID()},
                                      now() + interval '7 days', now() + interval '8 days', 'published')
                              RETURNING id`;
    const [tier] = await sql`INSERT INTO ticket_types (event_id, name, price, quantity_total)
                             VALUES (${event.id}, 'Regular', 1000, 100) RETURNING id`;
    const [promo] = await sql`INSERT INTO promo_codes (event_id, kind, code, rate)
                              VALUES (${event.id}, 'discount', ${"S2" + Date.now()}, 10) RETURNING id`;
    ids = { user: user.id, org: org.id, event: event.id, tier: tier.id, promo: promo.id };
  });

  beforeEach(async () => {
    inject.outboxFails = false;
    emailed.length = 0;
    await sql`UPDATE ticket_types SET quantity_sold = 0, quantity_reserved = 0, status = 'active' WHERE id = ${ids.tier}`;
    await sql`UPDATE promo_codes SET used_count = 0 WHERE id = ${ids.promo}`;
  });

  afterAll(async () => {
    await sql`DROP TRIGGER IF EXISTS stage2_break_promo ON promo_codes`;
    await sql`DROP FUNCTION IF EXISTS stage2_break_promo()`;
    await sql`DELETE FROM notification_events WHERE payload->>'eventId' = ${ids.event}`;
    await sql`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE event_id = ${ids.event})`;
    await sql`DELETE FROM tickets WHERE event_id = ${ids.event}`;
    await sql`DELETE FROM orders WHERE event_id = ${ids.event}`;
    await sql`DELETE FROM promo_codes WHERE event_id = ${ids.event}`;
    await sql`DELETE FROM ticket_types WHERE event_id = ${ids.event}`;
    await sql`DELETE FROM events WHERE id = ${ids.event}`;
    await sql`DELETE FROM organizations WHERE id = ${ids.org}`;
    await sql`DELETE FROM users WHERE id = ${ids.user}`;
  });

  it("completes a paid order and records order.paid in the same save", async () => {
    const { orderId, reference } = await seedCheckout({ quantity: 2, promo: true });
    const result = await finalize.finalizePaidOrder(reference);
    expect(result).toMatchObject({ ok: true, orderId, alreadyDone: false, emailSent: true });

    const s = await stateOf(orderId, reference);
    expect(s).toMatchObject({
      order: "paid",
      payment: "success",
      tickets: ["valid", "valid"],
      sold: 2,
      reserved: 0,
      promoUses: 1,
    });
    expect(s.events).toHaveLength(1);
    expect(s.events[0].type).toBe("order.paid");
    expect(s.events[0].payload).toMatchObject({ orderId, eventId: ids.event });
    expect(emailed).toEqual([orderId]);
  });

  it("a repeat (webhook retry, return page) changes nothing", async () => {
    const { orderId, reference } = await seedCheckout();
    await finalize.finalizePaidOrder(reference);
    const again = await finalize.finalizePaidOrder(reference);
    expect(again).toMatchObject({ ok: true, alreadyDone: true });
    const s = await stateOf(orderId, reference);
    expect(s.sold).toBe(1);
    expect(s.events).toHaveLength(1);
    expect(emailed).toEqual([orderId]); // emailed once
  });

  it("a failure part-way saves NOTHING, and the retry then completes everything", async () => {
    const { orderId, reference } = await seedCheckout({ promo: true });

    inject.outboxFails = true;
    await expect(finalize.finalizePaidOrder(reference)).rejects.toThrow(/injected failure/);

    // The old bug: the payment would now say "success" with the order still
    // pending, and every retry would skip it. Now nothing at all was saved.
    expect(await stateOf(orderId, reference)).toMatchObject({
      order: "pending",
      payment: "initialized",
      tickets: ["pending"],
      sold: 0,
      reserved: 1,
      promoUses: 0,
      events: [],
    });
    expect(emailed).toEqual([]);

    // Paystack's retry arrives.
    inject.outboxFails = false;
    const retry = await finalize.finalizePaidOrder(reference);
    expect(retry).toMatchObject({ ok: true, alreadyDone: false });
    const s = await stateOf(orderId, reference);
    expect(s).toMatchObject({ order: "paid", payment: "success", tickets: ["valid"], sold: 1, reserved: 0, promoUses: 1 });
    expect(s.events).toHaveLength(1);
  });

  it("two callers at once: exactly one completes the order", async () => {
    const { orderId, reference } = await seedCheckout({ quantity: 3 });
    const results = await Promise.all([
      finalize.finalizePaidOrder(reference),
      finalize.finalizePaidOrder(reference),
      finalize.finalizePaidOrder(reference),
    ]);
    const winners = results.filter((r) => r.ok && !r.alreadyDone);
    expect(winners).toHaveLength(1);
    const s = await stateOf(orderId, reference);
    expect(s.sold).toBe(3);
    expect(s.reserved).toBe(0);
    expect(s.events).toHaveLength(1);
    expect(emailed).toEqual([orderId]);
  });

  it("a promo-count failure never undoes the purchase", async () => {
    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION stage2_break_promo() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'promo counter is broken'; END $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS stage2_break_promo ON promo_codes;
      CREATE TRIGGER stage2_break_promo BEFORE UPDATE ON promo_codes
        FOR EACH ROW EXECUTE FUNCTION stage2_break_promo();`);
    try {
      const { orderId, reference } = await seedCheckout({ promo: true });
      const result = await finalize.finalizePaidOrder(reference);
      expect(result).toMatchObject({ ok: true, alreadyDone: false });
      const s = await stateOf(orderId, reference);
      expect(s).toMatchObject({ order: "paid", payment: "success", tickets: ["valid"], sold: 1, promoUses: 0 });
      expect(s.events).toHaveLength(1);
    } finally {
      await sql`DROP TRIGGER IF EXISTS stage2_break_promo ON promo_codes`;
    }
  });

  it("marks the tier sold out in the same save when the last seat goes", async () => {
    await sql`UPDATE ticket_types SET quantity_total = 2 WHERE id = ${ids.tier}`;
    try {
      const { orderId, reference } = await seedCheckout({ quantity: 2 });
      await finalize.finalizePaidOrder(reference);
      const s = await stateOf(orderId, reference);
      expect(s.tierStatus).toBe("sold_out");
    } finally {
      await sql`UPDATE ticket_types SET quantity_total = 100, status = 'active' WHERE id = ${ids.tier}`;
    }
  });

  it("completes a free RSVP all-or-nothing too, recording order.confirmed", async () => {
    const { orderId, reference } = await seedCheckout({ free: true });

    inject.outboxFails = true;
    await expect(finalize.finalizeFreeOrder(orderId)).rejects.toThrow(/injected failure/);
    expect(await stateOf(orderId, reference)).toMatchObject({ order: "pending", tickets: ["pending"], sold: 0, events: [] });

    inject.outboxFails = false;
    expect(await finalize.finalizeFreeOrder(orderId)).toBe(true);
    expect(await finalize.finalizeFreeOrder(orderId)).toBe(false); // repeat does nothing
    const s = await stateOf(orderId, reference);
    expect(s).toMatchObject({ order: "paid", tickets: ["valid"], sold: 1, reserved: 0 });
    expect(s.events.map((e) => e.type)).toEqual(["order.confirmed"]);
  });

  it("the sweep recreates a missing event once, and ignores orders from before go-live", async () => {
    // A paid order whose event went missing (a future code path forgot it).
    const { orderId: recent, reference: r1 } = await seedCheckout();
    await finalize.finalizePaidOrder(r1);
    await sql`DELETE FROM notification_events WHERE dedupe_key = ${`order.paid:${recent}`}`;
    // A free order, same situation.
    const { orderId: rsvp } = await seedCheckout({ free: true });
    await finalize.finalizeFreeOrder(rsvp);
    await sql`DELETE FROM notification_events WHERE dedupe_key = ${`order.confirmed:${rsvp}`}`;
    // An order paid before notifications went live.
    const { orderId: old, reference: r3 } = await seedCheckout();
    await finalize.finalizePaidOrder(r3);
    await sql`DELETE FROM notification_events WHERE dedupe_key = ${`order.paid:${old}`}`;
    await sql`UPDATE orders SET created_at = '2020-01-01' WHERE id = ${old}`;

    const first = await sweep.runReconciliationSweep();
    expect(first.since).toBeTruthy();
    const mine = async () =>
      sql`SELECT type, dedupe_key, payload FROM notification_events
          WHERE dedupe_key IN (${`order.paid:${recent}`}, ${`order.confirmed:${rsvp}`}, ${`order.paid:${old}`})
          ORDER BY type`;
    const rows = await mine();
    expect(rows.map((r) => r.dedupe_key).sort()).toEqual(
      [`order.confirmed:${rsvp}`, `order.paid:${recent}`].sort()
    );
    expect(rows.every((r) => r.payload.recoveredBySweep === true)).toBe(true);

    await sweep.runReconciliationSweep();
    expect(await mine()).toHaveLength(2); // a second sweep adds nothing
  });
});
