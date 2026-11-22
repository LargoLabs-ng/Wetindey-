/**
 * Phase 1 organizer and admin notifications, end to end on a REAL database:
 * the real trigger records the event in the same save, the worker fans it
 * out, and exactly the right people get the right bell entry.
 *
 * Skipped unless NOTIFICATIONS_DB_TEST_URL points at a throwaway database.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const URL = process.env.NOTIFICATIONS_DB_TEST_URL;

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const schema = await import("../../db/schema");
  const client = postgres(process.env.NOTIFICATIONS_DB_TEST_URL ?? "postgres://unused@127.0.0.1:1/x", {
    max: 6,
    prepare: false,
  });
  return { db: drizzle(client, { schema }), __client: client };
});

const mail: Array<{ to: string; subject: string }> = [];
vi.mock("@/lib/email-service", async (importOriginal) => {
  const real = await importOriginal<typeof import("../email-service")>();
  return {
    ...real,
    sendEmailWithResult: async (o: { to: string; subject: string }) => {
      mail.push({ to: o.to, subject: o.subject });
      return { ok: true, status: 200, id: `re_${randomUUID()}` };
    },
  };
});
vi.mock("@/lib/ticket-email", () => ({ sendTicketsForOrder: async () => {} }));

describe.skipIf(!URL)("organizer and admin notifications", () => {
  let sql: import("postgres").Sql;
  let db: typeof import("@/db").db;
  let worker: typeof import("./worker");
  let finalize: typeof import("../finalize-order");
  let payoutRequests: typeof import("../payout-requests");
  let register: typeof import("../register");
  let health: typeof import("./health");
  let sweep: typeof import("./sweep");
  let outbox: typeof import("./outbox");

  const P: Record<string, { id: string; email: string }> = {};
  let org: string, event: string, tier: string, uni: string;
  const adminsBefore = process.env.ADMIN_EMAILS;

  const inbox = async (who: string) =>
    sql`SELECT type, category, title, body, url FROM notifications WHERE user_id = ${P[who].id} ORDER BY created_at`;

  async function checkout(qty = 1, opts: { free?: boolean } = {}) {
    const total = opts.free ? 0 : 1500 * qty;
    const [o] = await sql`
      INSERT INTO orders (event_id, email, phone, subtotal, fees, total, status, platform_fee_paid_by, reservation_expires_at)
      VALUES (${event}, 'buyer@example.test', '0800', ${total}, 0, ${total}, 'pending', 'organizer', now() + interval '15 minutes')
      RETURNING id`;
    for (let i = 0; i < qty; i += 1) {
      await sql`INSERT INTO tickets (order_id, event_id, ticket_type_id, attendee_name, attendee_email, qr_token, status)
                VALUES (${o.id}, ${event}, ${tier}, 'Buyer', 'buyer@example.test', ${randomUUID()}, 'pending')`;
    }
    await sql`UPDATE ticket_types SET quantity_reserved = quantity_reserved + ${qty} WHERE id = ${tier}`;
    const reference = `WD-H-${randomUUID()}`;
    await sql`INSERT INTO payments (order_id, provider, provider_reference, amount, status)
              VALUES (${o.id}, ${opts.free ? "free" : "paystack"}, ${reference}, ${total}, ${opts.free ? "success" : "initialized"})`;
    return { orderId: o.id as string, reference };
  }

  beforeAll(async () => {
    process.env.NOTIFICATIONS_ENABLED = "true";
    process.env.NOTIFICATIONS_EMAIL_ENABLED = "true";
    const mod = (await import("@/db")) as unknown as { __client: import("postgres").Sql; db: typeof db };
    sql = mod.__client;
    db = mod.db;
    worker = await import("./worker");
    finalize = await import("../finalize-order");
    payoutRequests = await import("../payout-requests");
    register = await import("../register");
    health = await import("./health");
    sweep = await import("./sweep");
    outbox = await import("./outbox");

    for (const name of ["owner", "financeEditor", "plainEditor", "gate", "viewer", "removed", "admin", "stranger"]) {
      const email = `${name}-${randomUUID()}@example.test`;
      const [u] = await sql`INSERT INTO users (email, first_name, last_name) VALUES (${email}, ${name}, 'Test') RETURNING id`;
      P[name] = { id: u.id, email };
    }
    process.env.ADMIN_EMAILS = P.admin.email;

    const [o] = await sql`INSERT INTO organizations (name, slug, owner_id, bank_name, bank_account_name, bank_account_number)
                          VALUES ('Handlers Org', ${"h-" + randomUUID()}, ${P.owner.id}, 'Test Bank', 'Owner', '0123456789')
                          RETURNING id`;
    org = o.id;
    const [e] = await sql`INSERT INTO events (organization_id, title, slug, start_datetime, end_datetime, status)
                          VALUES (${org}, 'Campus Night', ${"h-" + randomUUID()}, now() + interval '7 days', now() + interval '8 days', 'published')
                          RETURNING id`;
    event = e.id;
    const [t] = await sql`INSERT INTO ticket_types (event_id, name, price, quantity_total) VALUES (${event}, 'Regular', 1500, 100) RETURNING id`;
    tier = t.id;
    const staff: Array<[string, string, boolean, string]> = [
      ["financeEditor", "event_manager", true, "active"],
      ["plainEditor", "event_manager", false, "active"],
      ["gate", "gate_staff", false, "active"],
      ["viewer", "viewer", false, "active"],
      ["removed", "event_manager", true, "removed"],
    ];
    for (const [who, role, fin, status] of staff) {
      await sql`INSERT INTO event_staff (event_id, user_id, user_email, role, status, can_see_finances)
                VALUES (${event}, ${P[who].id}, ${P[who].email}, ${role}, ${status}, ${fin})`;
    }
    const [u] = await sql`INSERT INTO universities (name, short_name, slug) VALUES ('Handlers University', 'HU', ${"hu-" + randomUUID()}) RETURNING id`;
    uni = u.id;
  });

  beforeEach(async () => {
    await sql`DELETE FROM notification_delivery_attempts`;
    await sql`DELETE FROM notification_deliveries`;
    await sql`DELETE FROM notifications`;
    await sql`DELETE FROM notification_events`;
    mail.length = 0;
    await sql`UPDATE ticket_types SET quantity_sold = 0, quantity_reserved = 0, quantity_total = 100, status = 'active' WHERE id = ${tier}`;
  });

  afterAll(async () => {
    process.env.ADMIN_EMAILS = adminsBefore;
    await sql`DELETE FROM notification_events WHERE payload->>'eventId' = ${event} OR payload->>'organizationId' = ${org}`;
    await sql`DELETE FROM payout_events WHERE payout_id IN (SELECT id FROM payouts WHERE organization_id = ${org})`;
    await sql`DELETE FROM payouts WHERE organization_id = ${org}`;
    await sql`DELETE FROM message_reports WHERE message_id IN (SELECT id FROM event_messages WHERE event_id = ${event})`;
    await sql`DELETE FROM event_messages WHERE event_id = ${event}`;
    await sql`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE event_id = ${event})`;
    await sql`DELETE FROM tickets WHERE event_id = ${event}`;
    await sql`DELETE FROM orders WHERE event_id = ${event}`;
    await sql`DELETE FROM event_staff WHERE event_id = ${event}`;
    await sql`DELETE FROM ticket_types WHERE event_id = ${event}`;
    await sql`DELETE FROM events WHERE id = ${event}`;
    await sql`DELETE FROM organizations WHERE id = ${org}`;
    await sql`DELETE FROM departments WHERE university_id = ${uni}`;
    await sql`DELETE FROM universities WHERE id = ${uni}`;
    for (const p of Object.values(P)) await sql`DELETE FROM users WHERE id = ${p.id}`;
  });

  it("a sale reaches the owner and finance-authorized staff only — in the bell, with no email", async () => {
    const { reference } = await checkout(2);
    await finalize.finalizePaidOrder(reference);
    await worker.runWorker({ timeBudgetMs: 10_000 });

    for (const who of ["owner", "financeEditor"]) {
      const rows = await inbox(who);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        type: "order.paid",
        category: "sales",
        title: "New sale · Campus Night",
        body: "2 × Regular · ₦3,000",
        url: `/dashboard/events/${event}`,
      });
    }
    for (const who of ["plainEditor", "gate", "viewer", "removed", "admin", "stranger"]) {
      expect(await inbox(who)).toHaveLength(0);
    }
    expect(mail).toHaveLength(0); // sale emails are the daily summary (Phase 2)
  });

  it("a free RSVP says so", async () => {
    const { orderId } = await checkout(1, { free: true });
    await finalize.finalizeFreeOrder(orderId);
    await worker.runWorker({ timeBudgetMs: 10_000 });
    const [row] = await inbox("owner");
    expect(row).toMatchObject({ type: "order.confirmed", title: "New RSVP · Campus Night", body: "1 × Regular" });
  });

  it("the last seat going sends one 'sold out' alert", async () => {
    await sql`UPDATE ticket_types SET quantity_total = 2 WHERE id = ${tier}`;
    const { reference } = await checkout(2);
    await finalize.finalizePaidOrder(reference);
    await worker.runWorker({ timeBudgetMs: 10_000 });
    const titles = (await inbox("owner")).map((r) => r.title);
    expect(titles).toContain("Sold out · Regular");
    expect(titles).toContain("New sale · Campus Night");
    expect((await inbox("plainEditor")).length).toBe(0);
  });

  it("a sale refunded before the worker got to it is not announced", async () => {
    const { orderId, reference } = await checkout(1);
    await finalize.finalizePaidOrder(reference);
    await sql`UPDATE orders SET status = 'refunded' WHERE id = ${orderId}`;
    await worker.runWorker({ timeBudgetMs: 10_000 });
    expect(await inbox("owner")).toHaveLength(0);
    const [e] = await sql`SELECT status FROM notification_events WHERE dedupe_key = ${`order.paid:${orderId}`}`;
    expect(e.status).toBe("done");
  });

  it("a payout request alerts admins; each admin action updates the owner only", async () => {
    // Settled money to draw on.
    const [paid] = await sql`
      INSERT INTO orders (event_id, email, phone, subtotal, fees, total, status, platform_fee_paid_by)
      VALUES (${event}, 'b@example.test', '0800', 50000, 2500, 50000, 'paid', 'organizer') RETURNING id`;
    await sql`INSERT INTO tickets (order_id, event_id, ticket_type_id, attendee_name, attendee_email, qr_token, status)
              VALUES (${paid.id}, ${event}, ${tier}, 'B', 'b@example.test', ${randomUUID()}, 'valid')`;
    await sql`INSERT INTO payments (order_id, provider, provider_reference, amount, status, settled_at, settlement_reference)
              VALUES (${paid.id}, 'paystack', ${"WD-S-" + randomUUID()}, 50000, 'success', now(), 'S-H')`;

    const request = await payoutRequests.createWithdrawalRequest({ organizationId: org, userId: P.owner.id, amount: 10000 });
    await worker.runWorker({ timeBudgetMs: 10_000 });
    const [adminRow] = await inbox("admin");
    expect(adminRow).toMatchObject({
      type: "payout.requested",
      category: "admin_actions",
      title: "Payout request waiting",
      body: "Handlers Org asked for ₦10,000.",
      url: `/admin/payouts/${request.id}`,
    });
    expect(await inbox("owner")).toHaveLength(0);

    await payoutRequests.applyPayoutAction({ payoutId: request.id, actorId: P.admin.id, action: { action: "approve" } });
    await worker.runWorker({ timeBudgetMs: 10_000 });
    const owner = await inbox("owner");
    expect(owner.map((r) => [r.type, r.category, r.title])).toEqual([
      ["payout.status_changed", "payouts", "Payout approved"],
    ]);
    expect(owner[0].body).toContain("₦10,000");
    for (const who of ["financeEditor", "plainEditor", "viewer"]) expect(await inbox(who)).toHaveLength(0);
  });

  it("a bank change warns the owner, showing only the last 4 digits", async () => {
    await sql`UPDATE organizations SET bank_name = 'New Bank', bank_account_number = '9876543210' WHERE id = ${org}`;
    await outbox.recordEvent(db, { type: "org.bank_changed", key: [org, randomUUID()], payload: { organizationId: org } });
    await worker.runWorker({ timeBudgetMs: 10_000 });
    const [row] = await inbox("owner");
    expect(row).toMatchObject({ category: "account_security", title: "Payout bank account changed" });
    expect(row.body).toContain("ending 3210");
    expect(row.body).not.toContain("9876543210");
    expect(await inbox("financeEditor")).toHaveLength(0);
  });

  it("a payment needing review reaches the super admins in the bell and by email", async () => {
    const { orderId } = await checkout(1);
    const [pay] = await sql`SELECT id FROM payments WHERE order_id = ${orderId}`;
    await outbox.recordEvent(db, {
      type: "payment.review",
      key: [pay.id],
      payload: { paymentId: pay.id, orderId, reason: "late_payment" },
    });
    await worker.runWorker({ timeBudgetMs: 10_000 });
    const [row] = await inbox("admin");
    expect(row).toMatchObject({ category: "admin_actions", title: "Payment needs review · Campus Night" });
    expect(row.body).toMatch(/after the seats were released/);
    expect(mail).toEqual([{ to: P.admin.email, subject: "Payment needs review · Campus Night" }]);
    expect(await inbox("owner")).toHaveLength(0);
  });

  it("a new department suggestion alerts the super admins, recorded in the signup's own save", async () => {
    await db.transaction(async (tx) => {
      await register.suggestDepartment(tx, { universityId: uni, name: `Marine Biology ${randomUUID().slice(0, 4)}`, suggestedBy: P.stranger.id });
    });
    await worker.runWorker({ timeBudgetMs: 10_000 });
    const [row] = await inbox("admin");
    expect(row).toMatchObject({ category: "admin_actions", title: "Department waiting for approval" });
    expect(row.body).toMatch(/at HU\./);
  });

  it("a reported message alerts the owner and editors, plus super admins — not viewers or gate staff", async () => {
    const [m] = await sql`INSERT INTO event_messages (event_id, author_id, body) VALUES (${event}, ${P.stranger.id}, 'buy followers here') RETURNING id`;
    const [r] = await sql`INSERT INTO message_reports (message_id, reporter_id, reason) VALUES (${m.id}, ${P.viewer.id}, 'spam') RETURNING id`;
    await outbox.recordEvent(db, { type: "message.reported", key: [r.id], payload: { reportId: r.id, messageId: m.id } });
    await worker.runWorker({ timeBudgetMs: 10_000 });
    for (const who of ["owner", "financeEditor", "plainEditor"]) {
      const [row] = await inbox(who);
      expect(row).toMatchObject({ category: "moderation", title: "Message reported · Campus Night" });
    }
    const [adminRow] = await inbox("admin");
    expect(adminRow.category).toBe("admin_actions");
    for (const who of ["gate", "viewer", "removed"]) expect(await inbox(who)).toHaveLength(0);
  });

  it("warns the super admins about failing notifications at most once a day", async () => {
    for (let i = 0; i < 3; i += 1) {
      await sql`INSERT INTO notification_deliveries (email, channel, category, dedupe_key, status, last_error)
                VALUES ('x@example.test', 'email', 'sales', ${"health-" + randomUUID()}, 'failed', 'Resend 503')`;
    }
    const first = await health.checkNotificationHealth();
    expect(first).toMatchObject({ unhealthy: true, alerted: true, failedLast24h: 3 });
    const second = await health.checkNotificationHealth();
    expect(second.alerted).toBe(false);
    await worker.runWorker({ timeBudgetMs: 10_000 });
    const [row] = await inbox("admin");
    expect(row).toMatchObject({ category: "platform_health", title: "Notifications need attention" });
    expect(mail.map((m) => m.subject)).toContain("Notifications need attention");
  });

  it("the sweep recovers a missing payout request event", async () => {
    const [p] = await sql`
      INSERT INTO payouts (organization_id, gross_amount, platform_fee, payment_processing_fee, net_amount, status, requested_at)
      VALUES (${org}, 0, 0, 0, 2000, 'pending', now()) RETURNING id`;
    const result = await sweep.runReconciliationSweep();
    expect(result.payoutRequestsRecovered).toBeGreaterThanOrEqual(1);
    const rows = await sql`SELECT 1 FROM notification_events WHERE dedupe_key = ${`payout.requested:${p.id}`}`;
    expect(rows).toHaveLength(1);
    const again = await sweep.runReconciliationSweep();
    expect(again.payoutRequestsRecovered).toBe(0);
  });
});
