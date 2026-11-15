import { describe, expect, it } from "vitest";
import {
  applyPromo,
  checkCode,
  DELETED_CODE_LABEL,
  describeOrderCode,
  normalizeCode,
  promoKindLabel,
  type PromoCode,
} from "./promo";

function code(over: Partial<PromoCode> = {}): PromoCode {
  return {
    id: "c1",
    kind: "discount",
    code: "SUMMER20",
    label: "Summer promo",
    promoterName: null,
    rate: 20,
    usageLimit: null,
    usedCount: 0,
    active: true,
    ...over,
  };
}

describe("normalizeCode", () => {
  it("uppercases and trims, because nobody types it as written", () => {
    expect(normalizeCode("  summer20 ")).toBe("SUMMER20");
  });

  it("refuses junk", () => {
    expect(normalizeCode("")).toBeNull();
    expect(normalizeCode("   ")).toBeNull();
    expect(normalizeCode(null)).toBeNull();
    expect(normalizeCode(42)).toBeNull();
    expect(normalizeCode("x".repeat(33))).toBeNull();
  });
});

describe("checkCode", () => {
  it("accepts a live code", () => {
    expect(checkCode(code()).ok).toBe(true);
  });

  it("refuses an unknown one without being rude about it", () => {
    const r = checkCode(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("recognise");
  });

  it("refuses a switched-off code", () => {
    expect(checkCode(code({ active: false })).ok).toBe(false);
  });

  it("refuses one that has hit its limit", () => {
    expect(checkCode(code({ usageLimit: 50, usedCount: 50 })).ok).toBe(false);
    expect(checkCode(code({ usageLimit: 50, usedCount: 49 })).ok).toBe(true);
  });

  it("treats a null limit as unlimited", () => {
    expect(checkCode(code({ usageLimit: null, usedCount: 9999 })).ok).toBe(true);
  });
});

describe("applyPromo — discounts", () => {
  it("takes the percentage off the face value", () => {
    const e = applyPromo(5000, code({ rate: 20 }));
    expect(e.discount).toBe(1000);
    expect(e.faceAfter).toBe(4000);
    expect(e.commission).toBe(0);
  });

  it("makes a ticket free at 100%, never negative", () => {
    const e = applyPromo(5000, code({ rate: 100 }));
    expect(e.discount).toBe(5000);
    expect(e.faceAfter).toBe(0);
  });

  // An organiser's typo weeks ago must not cost a sale today.
  it("clamps a rate above 100 instead of refusing the order", () => {
    const e = applyPromo(5000, code({ rate: 150 }));
    expect(e.faceAfter).toBe(0);
    expect(e.discount).toBe(5000);
  });

  it("clamps a negative rate to nothing off", () => {
    const e = applyPromo(5000, code({ rate: -20 }));
    expect(e.discount).toBe(0);
    expect(e.faceAfter).toBe(5000);
  });

  it("survives a rate that isn't a number", () => {
    const e = applyPromo(5000, code({ rate: NaN }));
    expect(e.discount).toBe(0);
    expect(e.faceAfter).toBe(5000);
  });

  it("rounds to the kobo", () => {
    const e = applyPromo(3333, code({ rate: 33 }));
    expect(e.discount).toBe(1099.89);
    expect(e.faceAfter).toBe(2233.11);
    expect(round2(e.discount + e.faceAfter)).toBe(3333);
  });

  it("does nothing to a free ticket", () => {
    const e = applyPromo(0, code({ rate: 50 }));
    expect(e).toEqual({ discount: 0, commission: 0, faceAfter: 0 });
  });
});

describe("applyPromo — referrals", () => {
  const ref = () =>
    code({
      kind: "refer_to_earn",
      code: "AMAKA7",
      promoterName: "Amaka",
      rate: 10,
    });

  it("leaves the price alone and records what's owed", () => {
    const e = applyPromo(5000, ref());
    expect(e.discount).toBe(0);
    expect(e.faceAfter).toBe(5000);
    expect(e.commission).toBe(500);
  });

  it("owes nothing on a free ticket", () => {
    expect(applyPromo(0, ref()).commission).toBe(0);
  });

  it("owes nothing at 0%, which is what carried-over codes have", () => {
    expect(applyPromo(5000, code({ kind: "refer_to_earn", rate: 0 })).commission).toBe(
      0
    );
  });

  it("rounds commission to the kobo", () => {
    expect(applyPromo(3333, ref()).commission).toBe(333.3);
  });
});

describe("applyPromo — no code", () => {
  it("passes the face value straight through", () => {
    expect(applyPromo(5000, null)).toEqual({
      discount: 0,
      commission: 0,
      faceAfter: 5000,
    });
  });

  it("refuses to produce a negative face value from bad input", () => {
    expect(applyPromo(-100, null).faceAfter).toBe(0);
    expect(applyPromo(NaN, null).faceAfter).toBe(0);
  });
});

const round2 = (n: number) => Math.round(n * 100) / 100;

describe("describeOrderCode — what the guest list shows", () => {
  const none = { discountAmount: "0", commissionAmount: "0" };

  it("shows the code on a discount order", () => {
    expect(
      describeOrderCode(
        { discountAmount: "1000.00", commissionAmount: "0" },
        { code: "SUMMER20", kind: "discount", promoterName: null }
      )
    ).toEqual({ code: "SUMMER20", kind: "discount", promoterName: null, deleted: false });
  });

  it("identifies a referral code and who earns on it", () => {
    expect(
      describeOrderCode(
        { discountAmount: "0", commissionAmount: "500.00" },
        { code: "AMAKA10", kind: "refer_to_earn", promoterName: "Amaka" }
      )
    ).toEqual({ code: "AMAKA10", kind: "refer_to_earn", promoterName: "Amaka", deleted: false });
  });

  it("shows nothing when no code was used", () => {
    expect(describeOrderCode(none, null)).toBeNull();
    // A left join with no match comes back as a row of nulls.
    expect(describeOrderCode(none, { code: null, kind: null, promoterName: null })).toBeNull();
  });

  it("says 'Deleted code' when a discount was recorded but the code is gone", () => {
    expect(
      describeOrderCode({ discountAmount: "2500.00", commissionAmount: "0" }, null)
    ).toEqual({ code: DELETED_CODE_LABEL, kind: "discount", promoterName: null, deleted: true });
  });

  it("says 'Deleted code' for a deleted referral code, and keeps it a referral", () => {
    const shown = describeOrderCode({ discountAmount: "0", commissionAmount: "300" }, null);
    expect(shown?.code).toBe(DELETED_CODE_LABEL);
    expect(shown?.kind).toBe("refer_to_earn");
    expect(shown?.deleted).toBe(true);
  });

  it("ignores junk amounts rather than inventing a code", () => {
    expect(describeOrderCode({ discountAmount: null, commissionAmount: undefined }, null)).toBeNull();
    expect(describeOrderCode({ discountAmount: "abc", commissionAmount: "-5" }, null)).toBeNull();
  });

  it("never shows a promoter name on a discount code", () => {
    expect(
      describeOrderCode(none, { code: "X1", kind: "discount", promoterName: "Stale name" })?.promoterName
    ).toBeNull();
  });
});

describe("promoKindLabel", () => {
  it("names the two kinds the way organisers see them", () => {
    expect(promoKindLabel("discount")).toBe("Discount");
    expect(promoKindLabel("refer_to_earn")).toBe("Referral");
  });
});
