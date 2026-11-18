import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Email verification links, without a new database table.
 *
 * Buying a ticket now requires a verified email: the account's address is
 * where tickets and receipts go, and it is what proves whose tickets they
 * are. Google sign-ins are verified by Google. Email-and-password accounts
 * prove it by clicking a link we send.
 *
 * The link carries a signed token: who (user id), which address, and when it
 * expires, signed with AUTH_SECRET. Nobody can make one without the secret,
 * changing any part breaks the signature, and the address is inside it so a
 * link only ever verifies the address it was sent to. On success the
 * existing `users.email_verified` column is set, so no migration is needed.
 *
 * The token isn't single-use. Clicking it twice verifies the same address
 * twice, which is harmless; a link that leaked would only verify an inbox
 * that already received it.
 */

export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

type Payload = { u: string; e: string; x: number };

function secret(explicit?: string): string {
  const value = explicit ?? process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set; cannot sign verification links.");
  return value;
}

function sign(body: string, key: string): string {
  return createHmac("sha256", key).update(`email-verification:${body}`).digest("base64url");
}

export function createVerificationToken(
  input: { userId: string; email: string },
  options: { now?: number; secret?: string } = {}
): string {
  const now = options.now ?? Date.now();
  const payload: Payload = {
    u: input.userId,
    e: input.email.trim().toLowerCase(),
    x: now + VERIFICATION_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret(options.secret))}`;
}

export function readVerificationToken(
  token: string | null | undefined,
  options: { now?: number; secret?: string } = {}
): { userId: string; email: string } | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;

  const expected = Buffer.from(sign(body, secret(options.secret)));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return null;
  }

  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof payload?.u !== "string" ||
    typeof payload?.e !== "string" ||
    typeof payload?.x !== "number"
  ) {
    return null;
  }
  if ((options.now ?? Date.now()) > payload.x) return null;

  return { userId: payload.u, email: payload.e };
}
