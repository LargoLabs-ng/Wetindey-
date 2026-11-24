import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LINK_DAYS,
  UNSUBSCRIBE_MARKER,
  readUnsubscribeToken,
  unsubscribeToken,
  withUnsubscribe,
} from "./unsubscribe";

const ADA = "11111111-1111-4111-8111-111111111111";
const BAYO = "22222222-2222-4222-8222-222222222222";
const before = { secret: process.env.AUTH_SECRET, url: process.env.NEXT_PUBLIC_APP_URL };

beforeEach(() => {
  process.env.AUTH_SECRET = "unit-test-secret";
  process.env.NEXT_PUBLIC_APP_URL = "https://wetindey.example";
});
afterEach(() => {
  process.env.AUTH_SECRET = before.secret;
  process.env.NEXT_PUBLIC_APP_URL = before.url;
});

describe("unsubscribe links", () => {
  it("reads back who and what the link is for", () => {
    const token = unsubscribeToken(ADA, "sales")!;
    expect(readUnsubscribeToken(token)).toEqual({ ok: true, userId: ADA, category: "sales" });
  });

  it("refuses a link that was changed in any way", () => {
    const token = unsubscribeToken(ADA, "sales")!;
    const [payload, signature] = token.split(".");
    // Someone swaps in another person's id, keeping the original signature.
    const forged = Buffer.from(JSON.stringify({ u: BAYO, c: "sales", x: 9_999_999_999 })).toString("base64url");
    expect(readUnsubscribeToken(`${forged}.${signature}`)).toEqual({ ok: false, reason: "invalid" });
    expect(readUnsubscribeToken(`${payload}.${signature.slice(0, -2)}xx`)).toEqual({ ok: false, reason: "invalid" });
    expect(readUnsubscribeToken(`${payload}`)).toEqual({ ok: false, reason: "invalid" });
    expect(readUnsubscribeToken("")).toEqual({ ok: false, reason: "invalid" });
    expect(readUnsubscribeToken(null)).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses a link signed with a different secret", () => {
    const token = unsubscribeToken(ADA, "sales")!;
    process.env.AUTH_SECRET = "another-secret";
    expect(readUnsubscribeToken(token).ok).toBe(false);
  });

  it(`stops working after ${LINK_DAYS} days`, () => {
    const made = new Date("2026-01-01T00:00:00Z");
    const token = unsubscribeToken(ADA, "sales", made)!;
    const justBefore = new Date(made.getTime() + (LINK_DAYS * 86_400 - 60) * 1000);
    const after = new Date(made.getTime() + (LINK_DAYS * 86_400 + 60) * 1000);
    expect(readUnsubscribeToken(token, justBefore).ok).toBe(true);
    expect(readUnsubscribeToken(token, after)).toEqual({ ok: false, reason: "expired" });
  });

  it("is never made for locked emails, and no link works without the server secret", () => {
    expect(unsubscribeToken(ADA, "payouts")).toBeNull();
    expect(unsubscribeToken(ADA, "tickets")).toBeNull();
    expect(unsubscribeToken(ADA, "account_security")).toBeNull();
    const token = unsubscribeToken(ADA, "sales")!;
    delete process.env.AUTH_SECRET;
    expect(unsubscribeToken(ADA, "sales")).toBeNull();
    expect(readUnsubscribeToken(token).ok).toBe(false);
  });
});

describe("withUnsubscribe", () => {
  const html = `<p>Hi</p>${UNSUBSCRIBE_MARKER}<p>©</p>`;

  it("adds the footer line and the mail-app headers to an email that can be turned off", () => {
    const out = withUnsubscribe(html, { userId: ADA, category: "sales", essential: false });
    expect(out.html).toContain("Don't want daily sales summary emails?");
    expect(out.html).toContain("https://wetindey.example/unsubscribe?t=");
    expect(out.html).toContain("https://wetindey.example/profile/notifications");
    expect(out.html).not.toContain(UNSUBSCRIBE_MARKER);
    expect(out.headers).toEqual({
      "List-Unsubscribe": expect.stringMatching(/^<https:\/\/wetindey\.example\/api\/notifications\/unsubscribe\?t=.+>$/),
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("leaves locked, urgent and anonymous emails without a link", () => {
    for (const opts of [
      { userId: ADA, category: "payouts", essential: false },
      { userId: ADA, category: "sales", essential: true },
      { userId: null, category: "sales", essential: false },
      { userId: ADA, category: "not-a-category", essential: false },
    ]) {
      const out = withUnsubscribe(html, opts);
      expect(out.html).toBe("<p>Hi</p><p>©</p>");
      expect(out.headers).toBeUndefined();
    }
  });
});
