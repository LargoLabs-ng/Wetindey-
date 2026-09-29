/**
 * The app's public base URL, with any trailing slash removed.
 *
 * Every caller was interpolating NEXT_PUBLIC_APP_URL straight into a path,
 * so a value stored with a trailing slash (which is how a browser hands it
 * to you when you copy it) produced links like "https://host//team/...".
 */
export function appUrl(path = ""): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000")
    .trim()
    .replace(/\/+$/, "");
  if (!path) return base;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Bare host of the public app ("ticketbuddy.ng"), for display in copy.
 * Derived from the same env var the real links use, so marketing copy can
 * never drift away from where the app actually lives.
 */
export function appHost(): string {
  return appUrl().replace(/^https?:\/\//, "");
}

/**
 * Public support address shown to buyers and printed in ticket emails.
 *
 * Deliberately has NO fallback. It used to default to an address on a domain
 * nobody owns, which meant every ticket email told a buyer to write to a
 * mailbox that did not exist — worse than showing no address at all. Set
 * NEXT_PUBLIC_SUPPORT_EMAIL once there is a real inbox; until then every
 * surface hides its contact line instead of printing a dead one.
 */
export const SUPPORT_EMAIL: string | null =
  (process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "").trim() || null;
