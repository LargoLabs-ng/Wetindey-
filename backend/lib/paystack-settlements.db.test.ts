/**
 * The settlement sync's write path against a REAL Postgres database, with
 * Paystack replaced by canned settlements. Skipped unless PAYOUT_DB_TEST_URL
 * is set (a throwaway database with migrations 0022–0024 applied).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const URL = process.env.PAYOUT_DB_TEST_URL;
const REF_SETTLED = `WD-SYNC-${randomUUID()}`;
const REF_WAITING = `WD-SYNC-${randomUUID()}`;
const REF_MISMATCH = `WD-SYNC-${randomUUID()}`;

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const schema = await import("../db/schema");
  const client = postgres(process.env.PAYOUT_DB_TEST_URL ?? "postgres://unused@127.0.0.1:1/x", { max: 3, prepare: false });
  return { db: drizzle(client, { schema }), __client: client };
});

vi.mock("@/lib/paystack-settlements-api", () => ({
  fetchSuccessfulSettlements: async () => ({
    unusable: 0,
    settlements: [
      {
        id: "S-SYNC-1",
        status: "success",
        settledAt: new Date("2026-11-20T00:00:00.000Z"),
        transactions: [
          { reference: REF_SETTLED, amountMinor: 500000, feesMinor: null, currency: "NGN", status: "success" },
          { reference: REF_MISMATCH, amountMinor: 1, feesMinor: null, currency: "NGN", status: "success" },
        ],
      },
    ],
  }),
}));

describe.skipIf(!URL)("settlement sync on a real database", () => {
  let sql: import("postgres").Sql;
  let ids: { user: string; org: string; event: string };

  beforeAll(async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_unused";
    const mod = (await import("@/db")) as unknown as { __client: import("postgres").Sql };
    sql = mod.__client;
    const [user] = await sql`INSERT INTO users (email) VALUES (${`sync-${randomUUID()}@example.test`}) RETURNING id`;
    const [org] = await sql`INSERT INTO organizations (name, slug, owner_id) VALUES ('Sync Org', ${"sync-" + randomUUID()}, ${user.id}) RETURNING id`;
    const [event] = await sql`
      INSERT INTO events (organization_id, title, slug, start_datetime, end_datetime)
      VALUES (${org.id}, 'Sync Event', ${"sync-" + randomUUID()}, now(), now()) RETURNING id`;
    ids = { user: user.id, org: org.id, event: event.id };
    for (const ref of [REF_SETTLED, REF_WAITING, REF_MISMATCH]) {
      const [order] = await sql`
        INSERT INTO orders (event_id, email, phone, subtotal, fees, total, status)
        VALUES (${event.id}, 'b@example.test', '0800', 5000, 250, 5000, 'paid') RETURNING id`;
      await sql`INSERT INTO payments (order_id, provider, provider_reference, amount, status)
                VALUES (${order.id}, 'paystack', ${ref}, 5000, 'success')`;
    }
  });

  afterAll(async () => {
    if (!sql || !ids) return;
    await sql`DELETE FROM payments WHERE provider_reference IN (${REF_SETTLED}, ${REF_WAITING}, ${REF_MISMATCH})`;
    await sql`DELETE FROM orders WHERE event_id = ${ids.event}`;
    await sql`DELETE FROM events WHERE id = ${ids.event}`;
    await sql`DELETE FROM organizations WHERE id = ${ids.org}`;
    await sql`DELETE FROM users WHERE id = ${ids.user}`;
    await sql.end();
  });

  const settledOf = async (ref: string) =>
    (await sql`SELECT settled_at, settlement_reference FROM payments WHERE provider_reference = ${ref}`)[0];

  it("refuses to write while the switch is off, and a dry run writes nothing", async () => {
    const { runPaystackSettlementSync } = await import("./paystack-settlements");
    delete process.env.SETTLEMENT_SYNC_ENABLED;
    await expect(runPaystackSettlementSync({ mode: "write", from: null })).rejects.toThrow(/switched off/);
    const dry = await runPaystackSettlementSync({ mode: "dry-run", from: null });
    expect(dry.report.toMark.map((m) => m.providerReference)).toContain(REF_SETTLED);
    expect(dry.written).toBe(0);
    expect((await settledOf(REF_SETTLED)).settled_at).toBeNull();
  });

  it("writes only the clean match, and a second run changes nothing", async () => {
    const { runPaystackSettlementSync } = await import("./paystack-settlements");
    process.env.SETTLEMENT_SYNC_ENABLED = "true";
    const first = await runPaystackSettlementSync({ mode: "write", from: null });
    expect(first.written).toBeGreaterThanOrEqual(1);
    expect(first.report.amountMismatch.map((m) => m.reference)).toContain(REF_MISMATCH);

    const settled = await settledOf(REF_SETTLED);
    expect(settled.settlement_reference).toBe("S-SYNC-1");
    expect(new Date(settled.settled_at).toISOString()).toBe("2026-11-20T00:00:00.000Z");
    expect((await settledOf(REF_WAITING)).settled_at).toBeNull();
    expect((await settledOf(REF_MISMATCH)).settled_at).toBeNull();

    const second = await runPaystackSettlementSync({ mode: "write", from: null });
    expect(second.written).toBe(0);
    expect(second.report.alreadyRecorded).toBeGreaterThanOrEqual(1);
    delete process.env.SETTLEMENT_SYNC_ENABLED;
  });
});
