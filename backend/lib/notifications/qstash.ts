/**
 * Is this request really from our QStash schedule?
 *
 * QStash signs every request with a short-lived token (the Upstash-Signature
 * header), using the project's signing keys. Upstash's own Receiver checks
 * the signature, the issuer, the expiry, the hash of the body, and the URL
 * it was sent to. The current and next keys are both accepted, so the keys
 * can be rotated in the Upstash console without downtime.
 *
 * QStash only ever says "run now": the request body is empty and carries no
 * notification content. The database is the only queue.
 */
import { Receiver } from "@upstash/qstash";

export function qstashConfigured(): boolean {
  return Boolean(process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY);
}

export async function verifyQStashRequest(input: {
  signature: string | null;
  body: string;
  /** The URLs this request may have been addressed to (the request's own, the public one). */
  urls: string[];
}): Promise<boolean> {
  if (!input.signature || !qstashConfigured()) return false;
  const receiver = new Receiver({
    currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
    nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
  });
  for (const url of [...new Set(input.urls.filter(Boolean))]) {
    try {
      if (await receiver.verify({ signature: input.signature, body: input.body, url })) return true;
    } catch {
      // A wrong URL, an expired token or a bad signature all throw; try the next URL.
    }
  }
  return false;
}
