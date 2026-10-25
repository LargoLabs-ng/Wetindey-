import { describe, expect, it } from "vitest";
import {
  PLATFORM_FEE_RATE,
  REFUND_RETAINED_RATE,
  naira,
  paystackGrossUp,
  paystackReverseGrossUp,
  quoteCancellationRefund,
  quoteOrder,
  quoteRefund,
  type FeeBearer,
} from "./fees";

const BEARERS: FeeBearer[] = ["organizer", "buyer"];

describe("Paystack fee estimate", () => {
  it("matches the prior local-card transaction example", () => {
    expect(paystackGrossUp(5300)).toBe(5482.24);
  });

  it("waives the flat fee below the threshold and caps larger fees", () => {
    expect(paystackGrossUp(2000)).toBeCloseTo(2000 / 0.985, 2);
    expect(paystackGrossUp(400_000) - 400_000).toBeLessThanOrEqual(2000);
  });

  it("reverse gross-up never exceeds the buyer's target", () => {
    for (let target = 25; target <= 500_000; target += 25) {
      const amount = paystackReverseGrossUp(target);
      expect(paystackGrossUp(amount)).toBeLessThanOrEqual(target + 0.001);
    }
  });
});

describe("quoteOrder", () => {
  it("charges no fees for free orders", () => {
    const quote = quoteOrder(0);
    expect(quote.buyerTotal).toBe(0);
    expect(quote.platformFee).toBe(0);
    expect(quote.processingFee).toBe(0);
    expect(quote.paystackAmount).toBe(0);
  });

  it("passes Paystack fees to the buyer and deducts 5% from organiser proceeds", () => {
    const quote = quoteOrder(5000);
    expect(quote.platformFee).toBe(5000 * PLATFORM_FEE_RATE);
    expect(quote.paystackAmount).toBe(5000);
    expect(quote.buyerTotal).toBe(paystackGrossUp(5000));
    expect(quote.processingFee).toBeCloseTo(
      quote.buyerTotal - quote.paystackAmount,
      2
    );
    expect(quote.organizerNet).toBe(5000 - quote.platformFee);
  });

  it("supports historical orders where the buyer paid the platform fee", () => {
    const quote = quoteOrder(5000, { platformFeePaidBy: "buyer" });
    expect(quote.paystackAmount).toBe(5250);
    expect(quote.buyerTotal).toBe(paystackGrossUp(5250));
    expect(quote.organizerNet).toBe(5000);
  });
});

describe("quoteRefund", () => {
  it("retains half the platform fee for a buyer-requested refund", () => {
    const organizerPaid = quoteRefund(5000, "organizer");
    expect(organizerPaid.buyerRefund).toBe(5000);
    expect(organizerPaid.platformKeeps).toBe(5000 * REFUND_RETAINED_RATE);
    expect(organizerPaid.organizerCharged).toBe(organizerPaid.platformKeeps);

    const buyerPaid = quoteRefund(5000, "buyer");
    expect(buyerPaid.buyerRefund).toBe(5125);
    expect(buyerPaid.organizerCharged).toBe(0);
  });

  it("refunds nothing for a free ticket", () => {
    expect(quoteRefund(0, "buyer")).toEqual({
      buyerRefund: 0,
      platformKeeps: 0,
      organizerCharged: 0,
    });
  });
});

describe("quoteCancellationRefund", () => {
  it("returns all buyer-paid money and keeps no platform fee", () => {
    const quote = quoteCancellationRefund(5000, "buyer");
    expect(quote.buyerRefund).toBe(5250);
    expect(quote.platformKeeps).toBe(0);
    expect(quote.organizerRefunded).toBe(0);
    expect(quote.processingLost).toBeGreaterThan(0);
  });

  it("returns the sticker price when the organizer paid the platform fee", () => {
    const quote = quoteCancellationRefund(5000, "organizer");
    expect(quote.buyerRefund).toBe(5000);
    expect(quote.platformKeeps).toBe(0);
    expect(quote.organizerRefunded).toBe(250);
  });

  it("estimates the buyer-paid Paystack fee that is not returned", () => {
    expect(quoteCancellationRefund(5000).processingLost).toBeGreaterThan(0);
  });
});

describe("naira", () => {
  it("formats whole and fractional amounts", () => {
    expect(naira(5000)).toBe("₦5,000");
    expect(naira(5177.66)).toBe("₦5,177.66");
  });
});
