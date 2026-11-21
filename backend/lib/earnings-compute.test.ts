import { describe, expect, it } from "vitest";
import {
  computeEarnings,
  orderOrganizerNet,
  type EarningsOrderInput,
  type EarningsPayoutInput,
} from "./earnings-compute";
import { quoteOrder } from "./fees";

const SETTLED = new Date("2026-11-20T00:00:00.000Z");

/** A paid order of `tickets` tickets at `face` total, 5% fee carried by the organiser. */
function order(face: number, extra: Partial<EarningsOrderInput> = {}): EarningsOrderInput {
  const tickets = extra.ticketCount ?? 1;
  return {
    id: `o-${Math.random()}`,
    eventId: "e1",
    status: "paid",
    subtotal: face.toFixed(2),
    fees: quoteOrder(face).platformFee.toFixed(2),
    platformFeePaidBy: "organizer",
    ticketCount: tickets,
    keptTicketCount: tickets,
    payment: { provider: "paystack", settledAt: SETTLED, organizerProcessingFee: 0, buyerProcessingFee: 0 },
    ...extra,
  };
}

const payout = (amount: number, status: string): EarningsPayoutInput => ({
  netAmount: amount.toFixed(2),
  status,
});

describe("orderOrganizerNet", () => {
  it("keeps the ticket money less the 5% fee, same as quoteOrder", () => {
    const result = orderOrganizerNet(order(5000));
    expect(result.net).toBe(quoteOrder(5000).organizerNet);
    expect(result.net).toBe(4750);
    expect(result.settled).toBe(true);
  });

  it("refunding 1 of 3 tickets removes a third of the order, not all of it", () => {
    const result = orderOrganizerNet(order(6000, { ticketCount: 3, keptTicketCount: 2 }));
    expect(result.keptFace).toBe(4000);
    expect(result.refundedFace).toBe(2000);
    expect(result.platformFee).toBe(200);
    expect(result.net).toBe(3800);
  });

  it("counts nothing for an order whose status is refunded", () => {
    const result = orderOrganizerNet(order(5000, { status: "refunded", keptTicketCount: 1 }));
    expect(result.net).toBe(0);
    expect(result.refundedFace).toBe(5000);
  });

  it("does not deduct the platform fee when the buyer carried it (legacy orders)", () => {
    const result = orderOrganizerNet(order(5000, { platformFeePaidBy: "buyer" }));
    expect(result.platformFee).toBe(0);
    expect(result.net).toBe(5000);
  });

  it("deducts a legacy Monnify fee in proportion to the live tickets", () => {
    const result = orderOrganizerNet(
      order(4000, {
        ticketCount: 2,
        keptTicketCount: 1,
        payment: { provider: "monnify", settledAt: SETTLED, organizerProcessingFee: 60, buyerProcessingFee: 0 },
      })
    );
    expect(result.processingFee).toBe(30);
    expect(result.net).toBe(2000 - 100 - 30);
  });

  it("never treats an order without a successful payment as settled", () => {
    expect(orderOrganizerNet(order(5000, { payment: null })).settled).toBe(false);
  });

  it("treats tickets cancelled with their event (refund still pending) as not live", () => {
    const result = orderOrganizerNet(order(5000, { keptTicketCount: 0 }));
    expect(result.net).toBe(0);
  });
});

describe("computeEarnings", () => {
  it("only settled money is available to withdraw", () => {
    const e = computeEarnings(
      [
        order(5000),
        order(3000, { payment: { provider: "paystack", settledAt: null, organizerProcessingFee: 0, buyerProcessingFee: 0 } }),
      ],
      []
    );
    expect(e.settledNet).toBe(4750);
    expect(e.unsettledNet).toBe(2850);
    expect(e.netEarned).toBe(7600);
    expect(e.available).toBe(4750);
  });

  it("subtracts paid and committed requests; rejected ones release the money", () => {
    const e = computeEarnings(
      [order(10000)],
      [
        payout(1000, "paid"),
        payout(500, "pending"),
        payout(500, "approved"),
        payout(500, "processing"),
        payout(500, "failed"),
        payout(4000, "rejected"),
      ]
    );
    expect(e.settledNet).toBe(9500);
    expect(e.paidOut).toBe(1000);
    expect(e.committed).toBe(2000);
    expect(e.pending).toBe(2000);
    expect(e.available).toBe(6500);
    expect(e.shortfall).toBe(0);
  });

  it("flags a shortfall instead of showing a negative balance", () => {
    // A request made before settlement tracking existed, for money that has
    // not been settled yet.
    const e = computeEarnings(
      [order(5000, { payment: { provider: "paystack", settledAt: null, organizerProcessingFee: 0, buyerProcessingFee: 0 } })],
      [payout(4750, "pending")]
    );
    expect(e.available).toBe(0);
    expect(e.shortfall).toBe(4750);
  });

  it("counts live tickets, not orders", () => {
    const e = computeEarnings(
      [order(6000, { ticketCount: 3, keptTicketCount: 2 }), order(2000)],
      []
    );
    expect(e.ticketsSold).toBe(3);
    expect(e.refunded).toBe(2000);
    expect(e.grossSales).toBe(6000);
  });

  it("free orders add tickets but no money", () => {
    const e = computeEarnings([order(0, { fees: "0.00" })], []);
    expect(e.ticketsSold).toBe(1);
    expect(e.netEarned).toBe(0);
  });

  it("keeps to the kobo across many orders", () => {
    const orders = Array.from({ length: 300 }, () => order(1234.56));
    const e = computeEarnings(orders, []);
    expect(e.grossSales).toBe(370368);
    expect(Number.isInteger(Math.round(e.netEarned * 100))).toBe(true);
  });
});
