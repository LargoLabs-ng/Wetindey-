import { describe, expect, it } from "vitest";
import { analyzeEventSales } from "./event-analytics";

const now = new Date("2026-10-18T12:00:00.000Z");
const day = (date: string) => new Date(`${date}T12:00:00.000Z`);

function analyze(
  overrides: Partial<Parameters<typeof analyzeEventSales>[0]> = {}
) {
  return analyzeEventSales({
    now,
    eventStart: day("2026-11-18"),
    eventDateTbd: false,
    eventStatus: "published",
    ticketsTotal: 20,
    ticketsSold: 8,
    orders: [],
    tickets: [],
    ...overrides,
  });
}

describe("analyzeEventSales", () => {
  it("builds a seven-day sales chart and compares equal completed weeks", () => {
    const result = analyze({
      orders: [
        { id: "old-week", createdAt: day("2026-10-10"), subtotal: "2000" },
        { id: "recent-one", createdAt: day("2026-10-12"), subtotal: "3000" },
        { id: "recent-two", createdAt: day("2026-10-17"), subtotal: "5000" },
        { id: "today", createdAt: day("2026-10-18"), subtotal: "9000" },
      ],
      tickets: [
        { orderId: "old-week", status: "valid" },
        { orderId: "recent-one", status: "valid" },
        { orderId: "recent-one", status: "checked_in" },
        { orderId: "recent-two", status: "valid" },
        { orderId: "today", status: "valid" },
      ],
    });

    expect(result.dailySales).toHaveLength(7);
    expect(result.dailySales[0]).toMatchObject({
      date: "2026-10-11",
      tickets: 0,
      revenue: 0,
    });
    expect(result.dailySales[1]).toMatchObject({
      date: "2026-10-12",
      tickets: 2,
      revenue: 3000,
    });
    expect(result.ticketsLast7Days).toBe(3);
    expect(result.ticketsPrevious7Days).toBe(1);
    expect(result.ticketSalesLast7Days).toBe(8000);
    expect(result.salesChangePercent).toBe(200);
    expect(result.salesTrend).toBe("up");
  });

  it("ignores unpaid tickets and prevents a sell-out estimate for TBA dates", () => {
    const result = analyze({
      eventDateTbd: true,
      orders: [
        { id: "paid", createdAt: day("2026-10-17"), subtotal: "1000" },
      ],
      tickets: [
        { orderId: "paid", status: "valid" },
        { orderId: "pending", status: "valid" },
        { orderId: "paid", status: "refunded" },
      ],
    });

    expect(result.ticketsLast7Days).toBe(1);
    expect(result.estimatedSellOutAt).toBeNull();
    expect(result.requiredDailyTickets).toBeNull();
  });

  it("does not divide by zero when there are no ticket tiers", () => {
    const result = analyze({ ticketsTotal: 0, ticketsSold: 0 });

    expect(result.sellThroughPercent).toBe(0);
    expect(result.averageDailyTickets).toBe(0);
    expect(result.insight).toContain("Add ticket tiers");
  });

  it("only forecasts a sell-out when the recent pace reaches capacity before event day", () => {
    const result = analyze({
      ticketsTotal: 10,
      ticketsSold: 5,
      orders: [
        { id: "sale", createdAt: day("2026-10-17"), subtotal: "2500" },
      ],
      tickets: [
        { orderId: "sale", status: "valid" },
        { orderId: "sale", status: "valid" },
        { orderId: "sale", status: "valid" },
        { orderId: "sale", status: "valid" },
        { orderId: "sale", status: "valid" },
      ],
    });

    expect(result.sellThroughPercent).toBe(50);
    expect(result.averageDailyTickets).toBeCloseTo(0.7);
    expect(result.estimatedSellOutAt).not.toBeNull();
    expect(result.insight).toContain("could sell out before the event");
  });

  it("prioritizes publishing guidance for a draft event", () => {
    const result = analyze({
      eventStatus: "draft",
      orders: [
        { id: "sale", createdAt: day("2026-10-17"), subtotal: "1000" },
      ],
      tickets: [{ orderId: "sale", status: "valid" }],
    });
    expect(result.insight).toContain("Publish your event");
    expect(result.estimatedSellOutAt).toBeNull();
  });
});
