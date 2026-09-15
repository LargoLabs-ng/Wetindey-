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
 * Override with NEXT_PUBLIC_SUPPORT_EMAIL; defaults to the brand domain.
 */
export const BRAND_DOMAIN = "ticketbuddy.ng";

export const SUPPORT_EMAIL =
  (process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "").trim() ||
  `support@${BRAND_DOMAIN}`;
