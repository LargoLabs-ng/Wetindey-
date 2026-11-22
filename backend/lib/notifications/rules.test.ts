import { describe, expect, it } from "vitest";
import { startOfLagosDay } from "./config";
import { digestKey, emailKey, eventKey, inboxKey, pushKey } from "./dedupe";
import {
  CATEGORIES,
  DEFAULTS,
  allowed,
  isLocked,
  resolveSwitch,
  type OverrideMap,
} from "./preferences";
import {
  MAX_ATTEMPTS,
  RETRY_DELAYS_SECONDS,
  afterTemporaryFailure,
  classifyFailure,
  trimError,
} from "./retry";

describe("the attempt rule: 5 total attempts, 4 waits", () => {
  it("allows exactly 5 attempts, including the first", () => {
    expect(MAX_ATTEMPTS).toBe(5);
    expect(RETRY_DELAYS_SECONDS).toHaveLength(4);
  });

  it("waits 1 min, 10 min, 1 h, 6 h after attempts 1–4 (no jitter)", () => {
    const mid = () => 0.5; // factor 1.0
    expect(afterTemporaryFailure(1, 5, mid)).toEqual({ kind: "retry", delaySeconds: 60 });
    expect(afterTemporaryFailure(2, 5, mid)).toEqual({ kind: "retry", delaySeconds: 600 });
    expect(afterTemporaryFailure(3, 5, mid)).toEqual({ kind: "retry", delaySeconds: 3600 });
    expect(afterTemporaryFailure(4, 5, mid)).toEqual({ kind: "retry", delaySeconds: 21600 });
  });

  it("gives up after a temporary failure on attempt 5", () => {
    expect(afterTemporaryFailure(5)).toEqual({ kind: "give_up" });
    expect(afterTemporaryFailure(6)).toEqual({ kind: "give_up" });
  });

  it("keeps the randomness within ±10%", () => {
    const low = afterTemporaryFailure(4, 5, () => 0);
    const high = afterTemporaryFailure(4, 5, () => 0.999999);
    expect(low).toEqual({ kind: "retry", delaySeconds: 19440 });
    expect(high.kind === "retry" && high.delaySeconds).toBeLessThanOrEqual(23760);
  });

  it("puts the last attempt about 7 hours after the first", () => {
    const total = RETRY_DELAYS_SECONDS.reduce((a, b) => a + b, 0);
    expect(total / 3600).toBeCloseTo(7.18, 1);
    expect(total).toBeLessThan(24 * 3600); // inside Resend's idempotency window
  });

  it("rejects nonsense attempt numbers", () => {
    expect(() => afterTemporaryFailure(0)).toThrow();
  });
});

describe("classifyFailure", () => {
  it("treats a bad request or a vanished destination as permanent", () => {
    for (const status of [400, 404, 410, 422]) {
      expect(classifyFailure({ status })).toBe("permanent");
    }
  });
  it("treats rate limits, server errors, auth trouble and network errors as temporary", () => {
    for (const status of [401, 403, 429, 500, 502, 503]) {
      expect(classifyFailure({ status })).toBe("temporary");
    }
    expect(classifyFailure({ error: "fetch failed" })).toBe("temporary");
  });
  it("trims long errors", () => {
    expect(trimError("x".repeat(900))).toHaveLength(500);
  });
});

describe("preference defaults", () => {
  it("covers every category and channel", () => {
    for (const c of CATEGORIES) {
      expect(Object.keys(DEFAULTS[c]).sort()).toEqual(["email", "in_app", "push"]);
    }
  });

  it("discovery: in-app on by default; email and push opt-in", () => {
    expect(resolveSwitch("discovery", "in_app", undefined)).toBe(true);
    expect(resolveSwitch("discovery", "email", undefined)).toBe(false);
    expect(resolveSwitch("discovery", "push", undefined)).toBe(false);
    expect(resolveSwitch("discovery", "email", true)).toBe(true);
    expect(resolveSwitch("discovery", "in_app", false)).toBe(false);
  });

  it("locked switches can't be turned off", () => {
    for (const [category, channel] of [
      ["tickets", "email"],
      ["tickets", "in_app"],
      ["payouts", "email"],
      ["account_security", "email"],
      ["platform_health", "email"],
      ["admin_actions", "in_app"],
    ] as const) {
      expect(isLocked(category, channel)).toBe(true);
      expect(resolveSwitch(category, channel, false)).toBe(true);
    }
  });

  it("organizer sales: in-app and email on by default, and can be turned off", () => {
    expect(resolveSwitch("sales", "in_app", undefined)).toBe(true);
    expect(resolveSwitch("sales", "email", undefined)).toBe(true);
    expect(resolveSwitch("sales", "email", false)).toBe(false);
  });

  it("an essential notification reaches someone who muted the category", () => {
    expect(resolveSwitch("announcements", "email", false, { essential: true })).toBe(true);
  });

  it("reads per-person overrides", () => {
    const overrides: OverrideMap = new Map([["u1", new Map([["sales:email", false]])]]);
    expect(allowed(overrides, "u1", "sales", "email")).toBe(false);
    expect(allowed(overrides, "u2", "sales", "email")).toBe(true);
    expect(allowed(overrides, null, "discovery", "email")).toBe(false); // guests get defaults
  });
});

describe("dedupe keys", () => {
  it("builds one key per layer", () => {
    const e = eventKey("order.paid", "o1");
    expect(e).toBe("order.paid:o1");
    expect(inboxKey(e, "u1")).toBe("order.paid:o1:u1");
    expect(emailKey(e, { userId: "u1", email: "a@x.com" })).toBe("order.paid:o1:u1:email");
    expect(emailKey(e, { email: " Ada@X.com " })).toBe("order.paid:o1:ada@x.com:email");
    expect(pushKey(e, "u1", "d9")).toBe("order.paid:o1:u1:push:d9");
    expect(digestKey("discovery", "u1", "2026-W48")).toBe("digest:discovery:u1:2026-W48");
  });
  it("refuses keys that would collide", () => {
    expect(() => eventKey("order.paid")).toThrow();
    expect(() => emailKey("k", {})).toThrow();
  });
});

describe("startOfLagosDay", () => {
  it("is 23:00 UTC the previous evening", () => {
    expect(startOfLagosDay(new Date("2026-11-22T10:00:00Z")).toISOString()).toBe(
      "2026-11-21T23:00:00.000Z"
    );
    // 23:30 UTC is already the next day in Lagos.
    expect(startOfLagosDay(new Date("2026-11-22T23:30:00Z")).toISOString()).toBe(
      "2026-11-22T23:00:00.000Z"
    );
  });
});
