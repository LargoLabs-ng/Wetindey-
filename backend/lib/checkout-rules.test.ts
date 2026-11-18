import { describe, expect, it } from "vitest";
import { checkTierSale, type SaleCheckEvent, type SaleCheckTier } from "./checkout-rules";

const now = new Date("2026-11-20T12:00:00Z");

const event = (over: Partial<SaleCheckEvent> = {}): SaleCheckEvent => ({
  status: "published",
  archivedAt: null,
  endDatetime: new Date("2026-12-01T22:00:00Z"),
  dateTbd: false,
  timeZone: "Africa/Lagos",
  ...over,
});

const tier = (over: Partial<SaleCheckTier> = {}): SaleCheckTier => ({
  status: "active",
  quantityTotal: 100,
  quantitySold: 10,
  quantityReserved: 5,
  salesStart: null,
  salesEnd: null,
  ...over,
});

const check = (e = event(), t = tier(), quantity = 1) =>
  checkTierSale({ event: e, tier: t, quantity, now });

describe("checkTierSale", () => {
  it("allows an ordinary sale and reports what's left", () => {
    expect(check()).toEqual({ ok: true, available: 85 });
  });

  it("refuses drafts, unpublished, cancelled and archived events", () => {
    for (const status of ["draft", "unpublished", "cancelled"]) {
      const result = check(event({ status }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("event_unavailable");
    }
    const archived = check(event({ archivedAt: new Date("2026-11-01") }));
    expect(!archived.ok && archived.code).toBe("event_unavailable");
  });

  it("refuses an event that has ended", () => {
    const result = check(event({ endDatetime: new Date("2026-11-20T11:59:00Z") }));
    expect(!result.ok && result.code).toBe("event_ended");
  });

  it("does not treat a provisional (TBA) date in the past as ended", () => {
    const result = check(
      event({ dateTbd: true, endDatetime: new Date("2026-01-01T00:00:00Z") })
    );
    expect(result.ok).toBe(true);
  });

  it("refuses paused and sold-out tiers", () => {
    const paused = check(event(), tier({ status: "paused" }));
    expect(!paused.ok && paused.code).toBe("tier_paused");

    const flagged = check(event(), tier({ status: "sold_out" }));
    expect(!flagged.ok && flagged.code).toBe("tier_sold_out");

    const full = check(event(), tier({ quantitySold: 95, quantityReserved: 5 }));
    expect(!full.ok && full.code).toBe("tier_sold_out");
  });

  it("refuses more than what's left without saying how many", () => {
    const result = check(event(), tier({ quantitySold: 98, quantityReserved: 0 }), 3);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("not_enough");
      expect(result.available).toBe(2);
      // The message must never reveal the number.
      expect(result.message).not.toMatch(/\d/);
    }
  });

  it("enforces the sales start, with the time in the event's own timezone", () => {
    const result = check(
      event({ timeZone: "Africa/Lagos" }),
      tier({ salesStart: new Date("2026-11-21T09:00:00Z") })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("sales_not_started");
      // 09:00 UTC is 10:00 in Lagos.
      expect(result.message).toMatch(/10:00/);
    }
  });

  it("enforces the sales end, inclusive of the closing moment", () => {
    const closed = check(event(), tier({ salesEnd: now }));
    expect(!closed.ok && closed.code).toBe("sales_ended");

    const open = check(event(), tier({ salesEnd: new Date(now.getTime() + 60_000) }));
    expect(open.ok).toBe(true);
  });

  it("accepts dates sent as strings", () => {
    const result = check(
      event({ endDatetime: "2026-11-19T00:00:00.000Z" }),
      tier()
    );
    expect(!result.ok && result.code).toBe("event_ended");
  });

  it("falls back to Lagos time when the stored timezone is unusable", () => {
    const result = check(
      event({ timeZone: "Not/AZone" }),
      tier({ salesStart: new Date("2026-11-21T09:00:00Z") })
    );
    expect(!result.ok && result.message).toMatch(/10:00/);
  });
});
