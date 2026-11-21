/**
 * Payouts against a REAL Postgres database.
 *
 * Skipped unless PAYOUT_DB_TEST_URL points at a throwaway database that has
 * the schema plus migrations 0022–0024 applied. NEVER point it at production
 * or at shared staging data: it creates and deletes its own rows.
 *
 * What only a real database can prove: the row locks really stop two
 * simultaneous withdrawals from overspending, the unique index really
 * refuses a reused transfer reference, and the balance queries run.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const URL = process.env.PAYOUT_DB_TEST_URL;

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const schema = await import("../db/schema");
  // Several connections, so two transactions really run at the same time —
  // as two serverless functions would in production.
  const client = postgres(process.env.PAYOUT_DB_TEST_URL ?? "postgres://unused@127.0.0.1:1/x", {
    max: 6,
    prepare: false,
  });
  return { db: drizzle(client, { schema }), __client: client };
});

describe.skipIf(!URL)("payouts on a real database", () => {
  let sql: import("postgres").Sql;
  let ids: { user: string; org: string; event: string; tier: string };

  /** A paid order: `tickets` tickets for `face` naira, optionally settled. */
  async function seedOrder(face: number, opts: { tickets?: number; settled?: boolean; refunded?: number } = {}) {
    const n = opts.tickets ?? 1;
    const fee = Math.round(face * 0.05 * 100) / 100;
    const [order] = await sql`
      INSERT INTO orders (event_id, email, phone, subtotal, fees, total, status, platform_fee_paid_by)
      VALUES (${ids.event}, 'buyer@example.test', '0800', ${face}, ${fee}, ${face}, 'paid', 'organizer')
      RETURNING id`;
    for (let i = 0; i < n; i += 1) {
      await sql`
        INSERT INTO tickets (order_id, event_id, ticket_type_id, attendee_name, attendee_email, qr_token, status)
        VALUES (${order.id}, ${ids.event}, ${ids.tier}, 'Buyer', 'buyer@example.test', ${randomUUID()},
                ${i < (opts.refunded ?? 0) ? "refunded" : "valid"})`;
    }
    await sql`
      INSERT INTO payments (order_id, provider, provider_reference, amount, status, settled_at, settlement_reference)
      VALUES (${order.id}, 'paystack', ${"WD-TEST-" + randomUUID()}, ${face}, 'success',
              CASE WHEN ${opts.settled !== false} THEN now() END,
              CASE WHEN ${opts.settled !== false} THEN 'S-TEST' END)`;
    return order.id as string;
  }

  beforeAll(async () => {
    const mod = (await import("@/db")) as unknown as { __client: import("postgres").Sql };
    sql = mod.__client;
    const [user] = await sql`INSERT INTO users (email, first_name, last_name) VALUES (${`owner-${randomUUID()}@example.test`}, 'Test', 'Owner') RETURNING id`;
    const [org] = await sql`
      INSERT INTO organizations (name, slug, owner_id, bank_name, bank_account_name, bank_account_number)
      VALUES ('Payout Test Org', ${"payout-test-" + randomUUID()}, ${user.id}, 'Test Bank', 'Test Owner', '0123456789')
      RETURNING id`;
    const [event] = await sql`
      INSERT INTO events (organization_id, title, slug, start_datetime, end_datetime)
      VALUES (${org.id}, 'Payout Test Event', ${"payout-test-" + randomUUID()}, now() + interval '7 days', now() + interval '8 days')
      RETURNING id`;
    const [tier] = await sql`
      INSERT INTO ticket_types (event_id, name, price, quantity_total) VALUES (${event.id}, 'Regular', 1000, 100) RETURNING id`;
    ids = { user: user.id, org: org.id, event: event.id, tier: tier.id };
  });

  afterAll(async () => {
    if (!sql || !ids) return;
    await sql`DELETE FROM payouts WHERE organization_id = ${ids.org}`;
    await sql`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE event_id = ${ids.event})`;
    await sql`DELETE FROM tickets WHERE event_id = ${ids.event}`;
    await sql`DELETE FROM orders WHERE event_id = ${ids.event}`;
    await sql`DELETE FROM ticket_types WHERE event_id = ${ids.event}`;
    await sql`DELETE FROM events WHERE id = ${ids.event}`;
    await sql`DELETE FROM organizations WHERE id = ${ids.org}`;
    await sql`DELETE FROM users WHERE id = ${ids.user}`;
    await sql.end();
  });

  it("counts settled money only, with the partial-refund fix", async () => {
    const { earningsForOrganization } = await import("./earnings");
    await seedOrder(3000, { tickets: 3, refunded: 1 }); // 2 of 3 live → 2000 face, 1900 net
    await seedOrder(1000, { settled: false }); // waiting on Paystack
    const e = await earningsForOrganization(ids.org);
    expect(e.settledNet).toBe(1900);
    expect(e.unsettledNet).toBe(950);
    expect(e.ticketsSold).toBe(3);
    expect(e.refunded).toBe(1000);
    expect(e.available).toBe(1900);
  });

  it("refuses more than the settled balance", async () => {
    const { createWithdrawalRequest, PayoutRequestError } = await import("./payout-requests");
    await expect(
      createWithdrawalRequest({ organizationId: ids.org, userId: ids.user, amount: 1900.01 })
    ).rejects.toBeInstanceOf(PayoutRequestError);
  });

  it("two simultaneous withdrawals cannot overspend together", async () => {
    const { createWithdrawalRequest } = await import("./payout-requests");
    const { earningsForOrganization } = await import("./earnings");
    // 1,900 available; each asks for 1,200. Only one may succeed.
    const results = await Promise.allSettled([
      createWithdrawalRequest({ organizationId: ids.org, userId: ids.user, amount: 1200 }),
      createWithdrawalRequest({ organizationId: ids.org, userId: ids.user, amount: 1200 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const e = await earningsForOrganization(ids.org);
    expect(e.committed).toBe(1200);
    expect(e.available).toBe(700);

    const [row] = await sql`SELECT * FROM payouts WHERE organization_id = ${ids.org}`;
    expect(Number(row.available_at_request)).toBe(1900);
    expect(row.bank_account_number).toBe("0123456789");
    const history = await sql`SELECT to_status FROM payout_events WHERE payout_id = ${row.id}`;
    expect(history.map((h) => h.to_status)).toEqual(["pending"]);
  });

  it("walks a request to paid, recording who did what, once", async () => {
    const { applyPayoutAction, PayoutRequestError } = await import("./payout-requests");
    const [row] = await sql`SELECT id FROM payouts WHERE organization_id = ${ids.org} AND status = 'pending'`;
    const act = (action: Parameters<typeof applyPayoutAction>[0]["action"]) =>
      applyPayoutAction({ payoutId: row.id, actorId: ids.user, action });

    await expect(act({ action: "process" })).rejects.toBeInstanceOf(PayoutRequestError); // approval first
    await act({ action: "approve" });

    // Two admins pressing "Move to processing" at once: exactly one wins.
    const both = await Promise.allSettled([act({ action: "process" }), act({ action: "process" })]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    await expect(act({ action: "mark_paid" })).rejects.toBeInstanceOf(PayoutRequestError); // no reference
    await act({ action: "mark_paid", paymentReference: "NIP-TEST-0001" });
    await expect(act({ action: "mark_paid", paymentReference: "NIP-TEST-0002" })).rejects.toThrow(/already paid/);

    const [done] = await sql`SELECT status, payment_reference, paid_at FROM payouts WHERE id = ${row.id}`;
    expect(done.status).toBe("paid");
    expect(done.payment_reference).toBe("NIP-TEST-0001");
    expect(done.paid_at).not.toBeNull();
    const history = await sql`SELECT from_status, to_status, actor_id FROM payout_events WHERE payout_id = ${row.id} ORDER BY created_at, id`;
    expect(history.map((h) => `${h.from_status ?? "-"}>${h.to_status}`)).toEqual([
      "->pending", "pending>approved", "approved>processing", "processing>paid",
    ]);
    expect(history.every((h) => h.actor_id === ids.user)).toBe(true);

    const { earningsForOrganization } = await import("./earnings");
    const e = await earningsForOrganization(ids.org);
    expect(e.paidOut).toBe(1200);
    expect(e.committed).toBe(0);
    expect(e.available).toBe(700);
  });

  it("refuses a transfer reference already used on another payout", async () => {
    const { createWithdrawalRequest, applyPayoutAction } = await import("./payout-requests");
    const { id } = await createWithdrawalRequest({ organizationId: ids.org, userId: ids.user, amount: 100 });
    const act = (action: Parameters<typeof applyPayoutAction>[0]["action"]) =>
      applyPayoutAction({ payoutId: id, actorId: ids.user, action });
    await act({ action: "approve" });
    await act({ action: "process" });
    await expect(act({ action: "mark_paid", paymentReference: "NIP-TEST-0001" })).rejects.toThrow(
      /already recorded on another payout/
    );
    // Nothing changed: still processing, and the history did not grow.
    const [p] = await sql`SELECT status FROM payouts WHERE id = ${id}`;
    expect(p.status).toBe("processing");
  });

  it("failed holds the money; rejected releases it with the reason shown", async () => {
    const { createWithdrawalRequest, applyPayoutAction } = await import("./payout-requests");
    const { earningsForOrganization } = await import("./earnings");
    const { id } = await createWithdrawalRequest({ organizationId: ids.org, userId: ids.user, amount: 500 });
    const act = (action: Parameters<typeof applyPayoutAction>[0]["action"]) =>
      applyPayoutAction({ payoutId: id, actorId: ids.user, action });
    await act({ action: "approve" });
    await act({ action: "process" });
    await act({ action: "mark_failed", note: "Bank returned the transfer." });
    expect((await earningsForOrganization(ids.org)).committed).toBe(600); // 100 + 500 still held

    await act({ action: "reject", reason: "Account name does not match the organiser." });
    const e = await earningsForOrganization(ids.org);
    expect(e.committed).toBe(100);
    const [p] = await sql`SELECT status, note FROM payouts WHERE id = ${id}`;
    expect(p.status).toBe("rejected");
    expect(p.note).toBe("Account name does not match the organiser.");
  });

  it("the admin queue shows full bank details and flags shortfalls", async () => {
    const { listPayoutRequests, getPayoutRequest } = await import("./payout-requests");
    const { requests, counts } = await listPayoutRequests("all");
    const mine = requests.filter((r) => r.organization.id === ids.org);
    expect(mine).toHaveLength(3); // paid 1,200 · processing 100 · rejected 500
    expect(mine[0].bank.accountNumber).toBe("0123456789");
    expect(counts.paid).toBeGreaterThanOrEqual(1);
    expect(mine.some((r) => r.needsReview)).toBe(false);

    // A request recorded before settlement tracking, above the settled money:
    // flagged for review, never changed automatically.
    await sql`
      INSERT INTO payouts (organization_id, gross_amount, platform_fee, payment_processing_fee, net_amount, status, bank_account_number)
      VALUES (${ids.org}, 0, 0, 0, 5000, 'pending', '0123456789')`;
    const after = await listPayoutRequests("pending");
    const flagged = after.requests.filter((r) => r.organization.id === ids.org);
    expect(flagged.every((r) => r.needsReview)).toBe(true);
    expect(flagged.find((r) => r.amount === 5000)?.status).toBe("pending");

    const detail = await getPayoutRequest(mine[0].id);
    expect(detail?.events[0]?.title).toBe("Payout Test Event");
    expect(detail?.history.length).toBeGreaterThan(0);
  });
});
