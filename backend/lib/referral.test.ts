import { describe, expect, it } from "vitest";
import {
  REFERRAL_TTL_MS,
  cleanRefCode,
  eventPathWithRef,
  recallRef,
  refFromQuery,
  rememberRef,
  withoutSelfReferral,
  type RefStorage,
} from "./referral";

function memoryStorage(): RefStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe("cleanRefCode", () => {
  it("upper-cases letters and digits", () => {
    expect(cleanRefCode(" amaka7 ")).toBe("AMAKA7");
  });

  it("drops anything that isn't a plain code", () => {
    expect(cleanRefCode("")).toBeNull();
    expect(cleanRefCode("AB CD")).toBeNull();
    expect(cleanRefCode("<script>")).toBeNull();
    expect(cleanRefCode("A".repeat(25))).toBeNull();
    expect(cleanRefCode(42)).toBeNull();
  });
});

describe("refFromQuery", () => {
  it("prefers p, falls back to the older ref", () => {
    const q = (o: Record<string, string>) => (n: string) => o[n];
    expect(refFromQuery(q({ p: "abc123", ref: "zzz" }))).toBe("ABC123");
    expect(refFromQuery(q({ ref: "zzz9" }))).toBe("ZZZ9");
    expect(refFromQuery(q({}))).toBeNull();
    expect(refFromQuery(q({ p: "bad code", ref: "GOOD1" }))).toBe("GOOD1");
  });
});

describe("eventPathWithRef (the /e/<slug> short link)", () => {
  it("keeps the promoter's code through the redirect", () => {
    expect(eventPathWithRef("campus-night", "AMAKA1")).toBe("/events/campus-night?p=AMAKA1");
  });

  it("is the plain event page without a code", () => {
    expect(eventPathWithRef("campus-night", null)).toBe("/events/campus-night");
  });
});

describe("rememberRef / recallRef", () => {
  const t0 = Date.UTC(2026, 10, 26, 12);

  it("remembers a code for 7 days on this phone", () => {
    const s = memoryStorage();
    rememberRef(s, "campus-night", "amaka1", t0);
    expect(recallRef(s, "campus-night", t0 + REFERRAL_TTL_MS - 1)).toBe("AMAKA1");
  });

  it("forgets it after 7 days and clears the entry", () => {
    const s = memoryStorage();
    rememberRef(s, "campus-night", "AMAKA1", t0);
    expect(recallRef(s, "campus-night", t0 + REFERRAL_TTL_MS)).toBeNull();
    expect(s.data.size).toBe(0);
  });

  it("is scoped per event", () => {
    const s = memoryStorage();
    rememberRef(s, "campus-night", "AMAKA1", t0);
    expect(recallRef(s, "other-event", t0)).toBeNull();
  });

  it("lets a newer link replace an older one (last link wins)", () => {
    const s = memoryStorage();
    rememberRef(s, "campus-night", "AMAKA1", t0);
    rememberRef(s, "campus-night", "TUNDE2", t0 + 1000);
    expect(recallRef(s, "campus-night", t0 + 2000)).toBe("TUNDE2");
  });

  it("clears a value it can't read", () => {
    const s = memoryStorage();
    s.setItem("wd-ref:campus-night", "AMAKA1");
    expect(recallRef(s, "campus-night", t0)).toBeNull();
    expect(s.data.size).toBe(0);
  });
});

describe("withoutSelfReferral", () => {
  it("credits a promoter's link when someone else buys", () => {
    expect(withoutSelfReferral({ buyerId: "buyer", linkPromoterId: "amaka", codeOwnerUserId: null })).toEqual({
      promoterId: "amaka",
      dropCode: false,
    });
  });

  it("credits nobody when the promoter buys through their own link", () => {
    expect(withoutSelfReferral({ buyerId: "amaka", linkPromoterId: "amaka", codeOwnerUserId: null })).toEqual({
      promoterId: null,
      dropCode: false,
    });
  });

  it("drops a referral code linked to the buyer's own account", () => {
    expect(withoutSelfReferral({ buyerId: "amaka", linkPromoterId: null, codeOwnerUserId: "amaka" }).dropCode).toBe(true);
  });

  it("keeps a code linked to someone else, or not linked at all", () => {
    expect(withoutSelfReferral({ buyerId: "buyer", linkPromoterId: null, codeOwnerUserId: "amaka" }).dropCode).toBe(false);
    expect(withoutSelfReferral({ buyerId: "buyer", linkPromoterId: null, codeOwnerUserId: null }).dropCode).toBe(false);
  });
});
