import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
const { ticketSales } = await import("./event-revenue");

const t = (orderId: string, ticketTypeId: string, status = "valid") => ({ orderId, ticketTypeId, status });

describe("ticketSales", () => {
  it("uses the ticket subtotal, not what the buyer paid with fees", () => {
    // ₦5,000 ticket; the buyer paid ₦5,177.67 with Paystack's fee on top.
    const result = ticketSales([{ id: "o1", subtotal: "5000.00" }], [t("o1", "vip")]);
    expect(result.total).toBe(5000);
    expect(result.byTicketType.get("vip")).toBe(5000);
  });

  it("uses the discounted subtotal when a code was used", () => {
    expect(ticketSales([{ id: "o1", subtotal: 4000 }], [t("o1", "vip")]).total).toBe(4000);
  });

  it("drops the share of refunded tickets", () => {
    const result = ticketSales(
      [{ id: "o1", subtotal: 3000 }],
      [t("o1", "reg"), t("o1", "reg", "refunded"), t("o1", "reg", "checked_in")]
    );
    expect(result.total).toBe(2000);
    expect(result.byTicketType.get("reg")).toBe(2000);
  });

  it("adds up several orders across ticket types", () => {
    const result = ticketSales(
      [
        { id: "o1", subtotal: 3000 },
        { id: "o2", subtotal: 5000 },
        { id: "o3", subtotal: 0 },
      ],
      [t("o1", "reg"), t("o1", "reg"), t("o2", "vip"), t("o3", "free")]
    );
    expect(result.total).toBe(8000);
    expect(result.byTicketType.get("reg")).toBe(3000);
    expect(result.byTicketType.get("vip")).toBe(5000);
    expect(result.byTicketType.get("free")).toBe(0);
  });

  it("counts a paid order with no ticket rows whole, like the Finance page", () => {
    expect(ticketSales([{ id: "o1", subtotal: 1500 }], []).total).toBe(1500);
  });

  it("rounds to kobo", () => {
    const result = ticketSales([{ id: "o1", subtotal: 1000 }], [t("o1", "a"), t("o1", "a"), t("o1", "a", "refunded")]);
    expect(result.total).toBe(666.67);
  });
});
