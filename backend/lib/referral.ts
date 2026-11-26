/**
 * Keeping a promoter's code attached to the buyer they sent.
 *
 * A promoter shares `/e/<slug>?p=AMAKA7`. Between that tap and a paid order
 * the buyer usually: gets redirected to the full event page, signs up,
 * confirms their email from a link that opens in a new tab, and maybe closes
 * WhatsApp and comes back the next day. Every one of those steps used to drop
 * the code. These helpers are what each step uses to hold on to it.
 *
 * Nothing here decides who gets credit — the server still resolves the code
 * itself when the order is created (resolvePromoter in the orders route), and
 * ignores anything it doesn't recognise. These only make sure the code
 * arrives.
 */

/** How long a promoter's link keeps credit on this phone. */
export const REFERRAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const STORAGE_PREFIX = "wd-ref";

/**
 * A code as it may appear in a link: letters and digits, at most 24.
 * Anything else is dropped rather than carried around.
 */
export function cleanRefCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.trim();
  if (!code || code.length > 24 || !/^[A-Za-z0-9]+$/.test(code)) return null;
  return code.toUpperCase();
}

/** The promoter's code from a page's query string (`p`, or the older `ref`). */
export function refFromQuery(
  get: (name: string) => string | null | undefined
): string | null {
  return cleanRefCode(get("p") ?? undefined) ?? cleanRefCode(get("ref") ?? undefined);
}

/**
 * Where the short link `/e/<slug>` sends people: the event page, carrying the
 * promoter's code and nothing else.
 */
export function eventPathWithRef(slug: string, ref: string | null): string {
  const path = `/events/${encodeURIComponent(slug)}`;
  return ref ? `${path}?p=${encodeURIComponent(ref)}` : path;
}

/** The bits of `Storage` used here, so tests can pass a plain object. */
export type RefStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const storageKey = (slug: string) => `${STORAGE_PREFIX}:${slug}`;

/**
 * Remember a code for this event on this phone, for REFERRAL_TTL_MS.
 * Scoped per event, so one event's link never credits a sale at another.
 */
export function rememberRef(
  storage: RefStorage,
  slug: string,
  code: string,
  now: number
): void {
  const clean = cleanRefCode(code);
  if (!clean) return;
  storage.setItem(
    storageKey(slug),
    JSON.stringify({ code: clean, expiresAt: now + REFERRAL_TTL_MS })
  );
}

/**
 * The code remembered for this event, if it hasn't expired. An expired or
 * unreadable entry is removed.
 */
export function recallRef(storage: RefStorage, slug: string, now: number): string | null {
  const key = storageKey(slug);
  const raw = storage.getItem(key);
  if (!raw) return null;

  try {
    const saved = JSON.parse(raw) as { code?: unknown; expiresAt?: unknown };
    const code = cleanRefCode(saved?.code);
    const expiresAt = Number(saved?.expiresAt);
    if (code && Number.isFinite(expiresAt) && expiresAt > now) return code;
  } catch {
    // Not JSON — fall through and clear it.
  }

  storage.removeItem(key);
  return null;
}

/**
 * Nobody earns from their own purchase.
 *
 * Every buyer is signed in (the order route requires a verified account), so
 * matching on the account is reliable:
 *  - a promoter link that resolves to the buyer themselves credits nobody;
 *  - a referral code linked to the buyer's own team account is dropped, so
 *    no commission is recorded and the code's use isn't counted. Referral
 *    codes never change the price, so the buyer pays exactly the same.
 *
 * The order always goes through.
 */
export function withoutSelfReferral(input: {
  buyerId: string;
  linkPromoterId: string | null;
  codeOwnerUserId: string | null;
}): { promoterId: string | null; dropCode: boolean } {
  return {
    promoterId: input.linkPromoterId === input.buyerId ? null : input.linkPromoterId,
    dropCode: input.codeOwnerUserId !== null && input.codeOwnerUserId === input.buyerId,
  };
}
