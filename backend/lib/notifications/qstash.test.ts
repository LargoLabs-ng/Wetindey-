import { createHash, createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { qstashConfigured, verifyQStashRequest } from "./qstash";

const CURRENT = "sig_current_test_key";
const NEXT = "sig_next_test_key";
const URL = "https://wetindey.example/api/cron/notifications?task=worker";

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** A token shaped exactly like the ones QStash sends. */
function sign(key: string, opts: { body?: string; url?: string; expInSeconds?: number } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss: "Upstash",
      sub: opts.url ?? URL,
      exp: now + (opts.expInSeconds ?? 300),
      nbf: now - 1,
      iat: now,
      jti: randomUUID(),
      body: b64url(createHash("sha256").update(opts.body ?? "").digest()),
    })
  );
  const signature = b64url(createHmac("sha256", key).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${signature}`;
}

describe("verifyQStashRequest", () => {
  beforeEach(() => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = CURRENT;
    process.env.QSTASH_NEXT_SIGNING_KEY = NEXT;
  });
  afterEach(() => {
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;
  });

  it("accepts a request signed with the current key", async () => {
    expect(await verifyQStashRequest({ signature: sign(CURRENT), body: "", urls: [URL] })).toBe(true);
  });

  it("accepts the next key too, so keys can be rotated without downtime", async () => {
    expect(await verifyQStashRequest({ signature: sign(NEXT), body: "", urls: [URL] })).toBe(true);
  });

  it("accepts it when only the public address matches", async () => {
    expect(
      await verifyQStashRequest({
        signature: sign(CURRENT),
        body: "",
        urls: ["https://internal.vercel.app/api/cron/notifications?task=worker", URL],
      })
    ).toBe(true);
  });

  it("refuses a forged signature", async () => {
    expect(await verifyQStashRequest({ signature: sign("not-our-key"), body: "", urls: [URL] })).toBe(false);
  });

  it("refuses a changed body", async () => {
    expect(
      await verifyQStashRequest({ signature: sign(CURRENT, { body: "" }), body: "{\"x\":1}", urls: [URL] })
    ).toBe(false);
  });

  it("refuses a token meant for another address", async () => {
    expect(
      await verifyQStashRequest({
        signature: sign(CURRENT, { url: "https://evil.example/hook" }),
        body: "",
        urls: [URL],
      })
    ).toBe(false);
  });

  it("refuses an expired token", async () => {
    expect(
      await verifyQStashRequest({ signature: sign(CURRENT, { expInSeconds: -60 }), body: "", urls: [URL] })
    ).toBe(false);
  });

  it("refuses a missing signature, and everything when the keys aren't set", async () => {
    expect(await verifyQStashRequest({ signature: null, body: "", urls: [URL] })).toBe(false);
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    expect(qstashConfigured()).toBe(false);
    expect(await verifyQStashRequest({ signature: sign(CURRENT), body: "", urls: [URL] })).toBe(false);
  });
});
