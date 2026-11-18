import { eq, inArray, sql as sqlRaw } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { events, orders, organizations, tickets, ticketTypes, users } from "@/db/schema";
import { holdSeats, secureSeatsForPayment } from "./inventory";

/**
 * Seat holds against a real Postgres.
 *
 * These create real rows (a throwaway user, organisation, event and tier)
 * and delete them afterwards, so they only run when explicitly asked to:
 * RUN_DB_WRITE_TESTS=1 *and* a reachable DATABASE_URL. Point that at the
 * Neon staging branch, never at production.
 *
 * The concurrency case uses two separate database connections, so the two
 * "buyers" really do race inside Postgres rather than queueing politely on
 * one client.
 */
const enabled = await (async () => {
  if (process.env.RUN_DB_WRITE_TESTS !== "1") {
    console.info("[inventory.test] RUN_DB_WRITE_TESTS is not 1 — skipping database tests");
    return false;
  }
  if (!process.env.DATABASE_URL) return false;
  try {
    await db.execute(sqlRaw`select 1`);
    return true;
  } catch (error) {
    console.info(`[inventory.test] database unreachable, skipping: ${(error as Error).message}`);
    return false;
  }
})();

describe.skipIf(!enabled)("seat holds (staging database)", () => {
  const stamp = `inv-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let userId: string;
  let organizationId: string;
  let eventId: string;
  const createdTiers: string[] = [];
  const createdOrders: string[] = [];

  async function newTier(quantityTotal: number) {
    const [tier] = await db
      .insert(ticketTypes)
      .values({ eventId, name: `Tier ${createdTiers.length + 1}`, price: "1000", quantityTotal })
      .returning();
    createdTiers.push(tier.id);
    return tier;
  }

  async function readTier(id: string) {
    const [tier] = await db.select().from(ticketTypes).where(eq(ticketTypes.id, id));
    return tier;
  }

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `${stamp}@example.invalid`, name: "Inventory test" })
      .returning();
    userId = user.id;
    const [org] = await db
      .insert(organizations)
      .values({ name: stamp, slug: stamp, ownerId: userId })
      .returning();
    organizationId = org.id;
    const [event] = await db
      .insert(events)
      .values({
        organizationId,
        title: stamp,
        slug: stamp,
        status: "published",
        startDatetime: new Date(Date.now() + 7 * 86400000),
        endDatetime: new Date(Date.now() + 7 * 86400000 + 3600000),
      })
      .returning();
    eventId = event.id;
  });

  afterAll(async () => {
    if (createdOrders.length) {
      await db.delete(orders).where(inArray(orders.id, createdOrders));
    }
    if (organizationId) {
      // Cascades to the event and its tiers.
      await db.delete(organizations).where(eq(organizations.id, organizationId));
    }
    if (userId) await db.delete(users).where(eq(users.id, userId));
  });

  it("lets only one of two simultaneous buyers hold the last ticket", async () => {
    const tier = await newTier(1);
    const url = process.env.DATABASE_URL!;
    const clientA = postgres(url, { max: 1, prepare: false, ssl: "require" });
    const clientB = postgres(url, { max: 1, prepare: false, ssl: "require" });
    const a = drizzle(clientA, { schema });
    const b = drizzle(clientB, { schema });
    try {
      const results = await Promise.all([
        holdSeats(tier.id, 1, { executor: a }),
        holdSeats(tier.id, 1, { executor: b }),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await readTier(tier.id)).quantityReserved).toBe(1);
    } finally {
      await clientA.end();
      await clientB.end();
    }
  });

  it("refuses more than what's left, and paused tiers for new checkouts", async () => {
    const tier = await newTier(3);
    expect(await holdSeats(tier.id, 4)).toBe(false);
    expect(await holdSeats(tier.id, 3)).toBe(true);
    expect(await holdSeats(tier.id, 1)).toBe(false);

    const paused = await newTier(5);
    await db.update(ticketTypes).set({ status: "paused" }).where(eq(ticketTypes.id, paused.id));
    expect(await holdSeats(paused.id, 1)).toBe(false);
    expect(await holdSeats(paused.id, 1, { onSaleOnly: false })).toBe(true);
  });

  async function expiredOrder(tierId: string, count: number) {
    const [order] = await db
      .insert(orders)
      .values({
        eventId,
        buyerId: userId,
        email: `${stamp}@example.invalid`,
        phone: "000",
        subtotal: "1000",
        fees: "0",
        total: "1000",
        status: "expired",
        reservationExpiresAt: new Date(Date.now() - 60_000),
      })
      .returning();
    createdOrders.push(order.id);
    await db.insert(tickets).values(
      Array.from({ length: count }, (_, i) => ({
        orderId: order.id,
        eventId,
        ticketTypeId: tierId,
        attendeeName: `Guest ${i + 1}`,
        attendeeEmail: `${stamp}@example.invalid`,
        qrToken: `${stamp}-${order.id}-${i}`,
        status: "cancelled" as const,
      }))
    );
    return order;
  }

  it("re-holds seats for a late payment when they're still free", async () => {
    const tier = await newTier(5);
    const order = await expiredOrder(tier.id, 2);

    expect(await secureSeatsForPayment(order.id)).toBe("held");

    const [after] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(after.status).toBe("pending");
    expect(after.reservationExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect((await readTier(tier.id)).quantityReserved).toBe(2);
    const issued = await db.select().from(tickets).where(eq(tickets.orderId, order.id));
    expect(issued.every((t) => t.status === "pending")).toBe(true);

    // A second caller (the webhook racing the browser) must not hold twice.
    expect(await secureSeatsForPayment(order.id)).toBe("held");
    expect((await readTier(tier.id)).quantityReserved).toBe(2);
  });

  it("holds nothing for a late payment when the seats have gone", async () => {
    const tier = await newTier(2);
    const order = await expiredOrder(tier.id, 2);
    // Someone else bought one of the two seats while this buyer was paying.
    await db.update(ticketTypes).set({ quantitySold: 1 }).where(eq(ticketTypes.id, tier.id));

    expect(await secureSeatsForPayment(order.id)).toBe("no-seats");

    const [after] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(after.status).toBe("expired");
    const fresh = await readTier(tier.id);
    expect(fresh.quantityReserved).toBe(0);
    expect(fresh.quantitySold).toBe(1);
  });

  it("leaves paid orders alone", async () => {
    const tier = await newTier(2);
    const order = await expiredOrder(tier.id, 1);
    await db.update(orders).set({ status: "paid" }).where(eq(orders.id, order.id));
    expect(await secureSeatsForPayment(order.id)).toBe("not-applicable");
    expect((await readTier(tier.id)).quantityReserved).toBe(0);
  });
});
