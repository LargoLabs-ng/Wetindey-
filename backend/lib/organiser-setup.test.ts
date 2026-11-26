import { describe, expect, it } from "vitest";
import {
  cleanLogoUrl,
  cleanOrganizationName,
  isHostingOrganization,
  needsOrganiserSetup,
  pickSetupTarget,
  type OwnedOrganization,
} from "./organiser-setup";

const org = (over: Partial<OwnedOrganization> = {}): OwnedOrganization => ({
  id: over.id ?? "o1",
  name: over.name ?? "Ada's Events",
  logoUrl: over.logoUrl ?? null,
  setupCompletedAt: over.setupCompletedAt ?? null,
  eventCount: over.eventCount ?? 0,
});

describe("isHostingOrganization", () => {
  it("counts a confirmed organisation", () => {
    expect(isHostingOrganization(org({ setupCompletedAt: new Date() }))).toBe(true);
  });
  it("counts an old organisation that already runs events", () => {
    expect(isHostingOrganization(org({ eventCount: 3 }))).toBe(true);
  });
  it("does not count an empty, never-confirmed one (old sign-ups)", () => {
    expect(isHostingOrganization(org())).toBe(false);
  });
});

describe("needsOrganiserSetup", () => {
  it("asks someone who owns nothing", () => {
    expect(needsOrganiserSetup([])).toBe(true);
  });
  it("asks the owner of only an empty, unconfirmed organisation", () => {
    expect(needsOrganiserSetup([org()])).toBe(true);
  });
  it("never sends an existing organiser with events back through it", () => {
    expect(needsOrganiserSetup([org({ eventCount: 1 })])).toBe(false);
  });
  it("is done once confirmed, even with no events yet", () => {
    expect(needsOrganiserSetup([org({ setupCompletedAt: new Date() })])).toBe(false);
  });
});

describe("pickSetupTarget", () => {
  it("is nothing for someone who owns nothing (a new one gets created)", () => {
    expect(pickSetupTarget([])).toBeNull();
  });
  it("reuses the oldest organisation instead of making a duplicate", () => {
    expect(pickSetupTarget([org({ id: "old" }), org({ id: "newer" })])?.id).toBe("old");
  });
  it("prefers one that is already hosting", () => {
    const picked = pickSetupTarget([org({ id: "empty" }), org({ id: "live", eventCount: 2 })]);
    expect(picked?.id).toBe("live");
  });
});

describe("cleanOrganizationName", () => {
  it("trims and collapses spaces", () => {
    expect(cleanOrganizationName("  UNICROSS   SUG ")).toEqual({ ok: true, name: "UNICROSS SUG" });
  });
  it("refuses blanks and one-letter names", () => {
    expect(cleanOrganizationName("   ").ok).toBe(false);
    expect(cleanOrganizationName("A").ok).toBe(false);
    expect(cleanOrganizationName(undefined).ok).toBe(false);
  });
  it("refuses names over the column limit", () => {
    expect(cleanOrganizationName("x".repeat(201)).ok).toBe(false);
    expect(cleanOrganizationName("x".repeat(200)).ok).toBe(true);
  });
});

describe("cleanLogoUrl", () => {
  it("leaves the logo alone when the field was not sent", () => {
    expect(cleanLogoUrl(undefined)).toBeUndefined();
  });
  it("removes it when sent empty", () => {
    expect(cleanLogoUrl("")).toBeNull();
    expect(cleanLogoUrl(null)).toBeNull();
  });
  it("accepts https links only", () => {
    expect(cleanLogoUrl("https://x.public.blob.vercel-storage.com/logos/a.png")).toBe(
      "https://x.public.blob.vercel-storage.com/logos/a.png"
    );
    expect(cleanLogoUrl("http://example.com/a.png")).toBeUndefined();
    expect(cleanLogoUrl("javascript:alert(1)")).toBeUndefined();
    expect(cleanLogoUrl(42)).toBeUndefined();
  });
});
