import { describe, expect, it } from "vitest";
import {
  PLATFORM_FEE_RATE,
  REFUND_RETAINED_RATE,
  paystackGrossUp,
  paystackReverseGrossUp,
  quoteOrder,
  quoteRefund,
  naira,
  type FeeBearer,
} from "./fees";

const BEARERS: FeeBearer[] = ["organizer", "buyer"];

/** Every price from ₦25 to ₦500,000, which is the realistic ticket range. */
function sweep(step = 25, max = 500_000) {
  const prices: number[] = [];
  for (let p = step; p <= max; p += step) prices.push(p);
  return prices;
}

describe("Paystack arithmetic", () => {
  it("matches a charge verified against the live account", () => {
    // ₦5,300 was charged as ₦5,482.24 on a real test transaction.
    expect(paystackGrossUp(5300)).toBe(5482.24);
  });

  it("waives the flat fee below the threshold", () => {
    expect(paystackGrossUp(2000)).toBeCloseTo(2000 / 0.985, 2);
  });

  it("caps the fee", () => {
    expect(paystackGrossUp(400_000) - 400_000).toBeLessThanOrEqual(2000);
  });

  it("reverseGrossUp never produces a charge above its target", () => {
    // The inverse is not a formula: the flat fee switches on at a threshold,
    // leaving totals no settlement amount produces exactly. Undershooting
    // costs the organizer a few naira; overshooting charges a buyer more
    // than they were quoted, which must never happen.
    for (const target of sweep()) {
      const amount = paystackReverseGrossUp(target);
      expect(paystackGrossUp(amount)).toBeLessThanOrEqual(target + 0.001);
    }
  });

  it("is exact at prices that previously drifted", () => {
    // ₦5,400 quoted as ₦5,402.71 when the inverse multiplied by (1 + rate)
    // instead of multiplying by (1 - rate).
    expect(paystackGrossUp(paystackReverseGrossUp(5400))).toBe(5400);
  });
});

describe("quoteOrder", () => {
  it("charges nothing on a free ticket", () => {
    for (const platformFeePaidBy of BEARERS)
      for (const processingFeePaidBy of BEARERS) {
        const q = quoteOrder(0, { platformFeePaidBy, processingFeePaidBy });
        expect(q.buyerTotal).toBe(0);
        expect(q.platformFee).toBe(0);
        expect(q.processingFee).toBe(0);
        expect(q.paystackAmount).toBe(0);
      }
  });

  it("puts the platform fee on the payout by default", () => {
    const q = quoteOrder(5000);
    expect(q.platformFee).toBe(5000 * PLATFORM_FEE_RATE);
    expect(q.buyerTotal).toBe(paystackGrossUp(5000));
    expect(q.organizerNet).toBe(5000 - q.platformFee);
  });

  it("never shows the buyer a fee the organizer is carrying", () => {
    const q = quoteOrder(5000, { platformFeePaidBy: "organizer" });
    // The buyer's total is the ticket price plus the card fee only.
    expect(q.buyerTotal).toBe(paystackGrossUp(q.subtotal));
  });

  it("charges the sticker price exactly when the organizer absorbs both", () => {
    const q = quoteOrder(5000, {
      platformFeePaidBy: "organizer",
      processingFeePaidBy: "organizer",
    });
    expect(q.buyerTotal).toBe(5000);
    expect(q.organizerNet).toBe(
      Math.round((5000 - q.platformFee - q.processingFee) * 100) / 100
    );
  });

  it("pays the organizer the full ticket price when the buyer carries both", () => {
    const q = quoteOrder(5000, {
      platformFeePaidBy: "buyer",
      processingFeePaidBy: "buyer",
    });
    expect(q.organizerNet).toBe(5000);
    expect(q.buyerTotal).toBeGreaterThan(5000 + q.platformFee);
  });

  it("never charges a buyer more than the page quoted, at any price", () => {
    for (const price of sweep())
      for (const platformFeePaidBy of BEARERS)
        for (const processingFeePaidBy of BEARERS) {
          const q = quoteOrder(price, { platformFeePaidBy, processingFeePaidBy });
          expect(paystackGrossUp(q.paystackAmount)).toBeLessThanOrEqual(
            q.buyerTotal + 0.001
          );
        }
  });

  it("keeps the organizer's shortfall small at the flat-fee threshold", () => {
    // ₦2,400-ish lands in a band where no settlement amount hits the target
    // exactly. Unavoidable, but it must stay small — a rounding bug once
    // pushed it to ₦1,917.
    let worst = 0;
    for (const price of sweep()) {
      const q = quoteOrder(price, { processingFeePaidBy: "organizer" });
      const shortfall = q.buyerTotal - paystackGrossUp(q.paystackAmount);
      worst = Math.max(worst, shortfall);
    }
    expect(worst).toBeLessThan(100);
  });

  it("reports the bearers it was given", () => {
    const q = quoteOrder(1000, {
      platformFeePaidBy: "buyer",
      processingFeePaidBy: "organizer",
    });
    expect(q.platformFeePaidBy).toBe("buyer");
    expect(q.processingFeePaidBy).toBe("organizer");
  });
});

describe("quoteRefund", () => {
  it("returns the ticket price when the organizer paid the fee", () => {
    const r = quoteRefund(5000, "organizer");
    expect(r.buyerRefund).toBe(5000);
    expect(r.platformKeeps).toBe(5000 * REFUND_RETAINED_RATE);
    expect(r.organizerCharged).toBe(r.platformKeeps);
  });

  it("returns the refundable half of the fee when the buyer paid it", () => {
    const r = quoteRefund(5000, "buyer");
    const fullFee = 5000 * PLATFORM_FEE_RATE;
    expect(r.buyerRefund).toBe(5000 + fullFee - r.platformKeeps);
    expect(r.organizerCharged).toBe(0);
  });

  it("keeps half the usual cut", () => {
    expect(REFUND_RETAINED_RATE).toBeCloseTo(PLATFORM_FEE_RATE / 2, 10);
  });

  it("refunds nothing on a free ticket", () => {
    const r = quoteRefund(0, "buyer");
    expect(r).toEqual({ buyerRefund: 0, platformKeeps: 0, organizerCharged: 0 });
  });
});

describe("naira", () => {
  it("drops decimals on whole amounts and keeps them otherwise", () => {
    expect(naira(5000)).toBe("₦5,000");
    expect(naira(5177.66)).toBe("₦5,177.66");
  });
});
