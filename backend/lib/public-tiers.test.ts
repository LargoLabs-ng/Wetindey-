import { describe, expect, it } from "vitest";
import { toPublicTier } from "./public-tiers";

const row = (over: Record<string, unknown> = {}) =>
  ({
    id: "t1",
    eventId: "e1",
    name: "Regular",
    description: null,
    price: "5000.00",
    currency: "NGN",
    quantityTotal: 100,
    quantitySold: 19,
    quantityReserved: 3,
    salesStart: null,
    salesEnd: null,
    earlyBirdEnabled: false,
    earlyBirdPrice: null,
    earlyBirdEndsAt: null,
    maxPerOrder: 10,
    admits: 1,
    flashKind: null,
    flashValue: null,
    flashStartsAt: null,
    flashEndsAt: null,
    status: "active",
    createdAt: new Date(),
    ...over,
  }) as unknown as Parameters<typeof toPublicTier>[0];

describe("toPublicTier", () => {
  it("never sends stock numbers", () => {
    const tier = toPublicTier(row());
    const keys = Object.keys(tier);
    for (const secret of ["quantityTotal", "quantitySold", "quantityReserved"]) {
      expect(keys).not.toContain(secret);
    }
    expect(JSON.stringify(tier)).not.toMatch(/\b(100|19|78)\b/);
    expect(tier.soldOut).toBe(false);
  });

  it("is sold out when nothing is left, including seats held by checkouts", () => {
    expect(toPublicTier(row({ quantitySold: 100, quantityReserved: 0 })).soldOut).toBe(true);
    expect(toPublicTier(row({ quantitySold: 98, quantityReserved: 2 })).soldOut).toBe(true);
  });

  it("is sold out when the system has marked it so", () => {
    expect(toPublicTier(row({ status: "sold_out" })).soldOut).toBe(true);
  });

  it("passes through what the page needs for price and the tier label", () => {
    const tier = toPublicTier(
      row({ earlyBirdEnabled: true, earlyBirdPrice: "4000.00", admits: 6, status: "paused" })
    );
    expect(tier).toMatchObject({
      id: "t1",
      name: "Regular",
      price: "5000.00",
      earlyBirdEnabled: true,
      earlyBirdPrice: "4000.00",
      admits: 6,
      status: "paused",
      maxPerOrder: 10,
    });
  });
});
