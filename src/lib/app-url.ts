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
