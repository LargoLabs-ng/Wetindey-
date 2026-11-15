import { describe, expect, it } from "vitest";
import { promoExportCells, promoExportHeader, shortOrderId } from "./attendee-export";
import type { OrderCode } from "./promo";

const ORDER = "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90";
const discount: OrderCode = { code: "SUMMER20", kind: "discount", promoterName: null, deleted: false };
const referral: OrderCode = { code: "AMAKA10", kind: "refer_to_earn", promoterName: "Amaka", deleted: false };

describe("promo columns in the guest-list CSV", () => {
  it("everyone gets the code, its type and the order ID", () => {
    expect(promoExportHeader(false)).toEqual(["Promo code", "Code type", "Order ID"]);
  });

  it("only people who can see finances get the naira column", () => {
    expect(promoExportHeader(true)).toEqual([
      "Promo code",
      "Code type",
      "Order ID",
      "Order discount (NGN)",
    ]);
  });

  it("cells line up with the header, with and without finances", () => {
    for (const fin of [true, false]) {
      const cells = promoExportCells({ orderId: ORDER, orderCode: discount, discountAmount: "1000" }, fin);
      expect(cells).toHaveLength(promoExportHeader(fin).length);
    }
  });

  it("a discount order, seen by finance", () => {
    expect(
      promoExportCells({ orderId: ORDER, orderCode: discount, discountAmount: "1000" }, true)
    ).toEqual(["SUMMER20", "Discount", "3F2A9C1E", "1000.00"]);
  });

  it("the same order, seen without finance: no amount anywhere", () => {
    const cells = promoExportCells({ orderId: ORDER, orderCode: discount, discountAmount: "1000" }, false);
    expect(cells).toEqual(["SUMMER20", "Discount", "3F2A9C1E"]);
    expect(cells.join(" ")).not.toContain("1000");
  });

  it("a referral is labelled Referral and gave no discount", () => {
    expect(
      promoExportCells({ orderId: ORDER, orderCode: referral, discountAmount: "0" }, true)
    ).toEqual(["AMAKA10", "Referral", "3F2A9C1E", "0.00"]);
  });

  it("no code: blank code, type and amount, order ID still there", () => {
    expect(
      promoExportCells({ orderId: ORDER, orderCode: null, discountAmount: "0" }, true)
    ).toEqual(["", "", "3F2A9C1E", ""]);
  });

  it("a deleted code keeps its type and amount", () => {
    expect(
      promoExportCells(
        {
          orderId: ORDER,
          orderCode: { code: "Deleted code", kind: "discount", promoterName: null, deleted: true },
          discountAmount: "2500.00",
        },
        true
      )
    ).toEqual(["Deleted code", "Discount", "3F2A9C1E", "2500.00"]);
  });

  it("short order IDs match the Ticket ID style", () => {
    expect(shortOrderId(ORDER)).toBe("3F2A9C1E");
  });
});
