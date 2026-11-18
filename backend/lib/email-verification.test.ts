import { describe, expect, it } from "vitest";
import {
  VERIFICATION_TTL_MS,
  createVerificationToken,
  readVerificationToken,
} from "./email-verification";

const secret = "test-secret-that-is-long-enough";
const now = Date.parse("2026-11-20T12:00:00Z");
const who = { userId: "11111111-2222-4333-8444-555555555555", email: "Ada@Gmail.com" };

describe("email verification tokens", () => {
  it("round-trips the user and a lowercased address", () => {
    const token = createVerificationToken(who, { now, secret });
    expect(readVerificationToken(token, { now, secret })).toEqual({
      userId: who.userId,
      email: "ada@gmail.com",
    });
  });

  it("expires after the time limit", () => {
    const token = createVerificationToken(who, { now, secret });
    expect(readVerificationToken(token, { now: now + VERIFICATION_TTL_MS - 1, secret })).not.toBeNull();
    expect(readVerificationToken(token, { now: now + VERIFICATION_TTL_MS + 1, secret })).toBeNull();
  });

  it("rejects a token signed with another secret", () => {
    const token = createVerificationToken(who, { now, secret: "someone-elses-secret" });
    expect(readVerificationToken(token, { now, secret })).toBeNull();
  });

  it("rejects any edit to the contents", () => {
    const token = createVerificationToken(who, { now, secret });
    const [, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ u: who.userId, e: "victim@gmail.com", x: now + VERIFICATION_TTL_MS })
    ).toString("base64url");
    expect(readVerificationToken(`${forged}.${signature}`, { now, secret })).toBeNull();
  });

  it("rejects junk", () => {
    for (const junk of [null, undefined, "", "abc", "a.b.c", "x".repeat(5000)]) {
      expect(readVerificationToken(junk as string, { now, secret })).toBeNull();
    }
  });
});
