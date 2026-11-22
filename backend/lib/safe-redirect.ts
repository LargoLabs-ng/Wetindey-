/**
 * Where someone may be sent after signing in, signing up or verifying their
 * email.
 *
 * Every one of those flows takes a destination from the address bar
 * (`?callbackUrl=`), which means anybody can put anything there. The rule is
 * simple: only a path on this site. Never another origin.
 *
 * The old inline check was `startsWith("/") && !startsWith("//")`. That
 * stops `//evil.example` but lets `/\evil.example` through, and browsers
 * treat a backslash after the first slash exactly like a second slash — so
 * it navigates off-site. Rather than chase spellings, this resolves the
 * value against a placeholder origin and accepts it only if it is still on
 * that origin afterwards.
 */
const PLACEHOLDER_ORIGIN = "http://wetindey.invalid";

export function safeCallbackPath(
  raw: string | null | undefined,
  fallback: string
): string {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim();
  if (!value.startsWith("/")) return fallback;
  // Backslashes and control characters have no business in one of our own
  // paths, and both are how "looks relative, is actually external" is done.
  if (value.includes("\\")) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;

  let parsed: URL;
  try {
    parsed = new URL(value, PLACEHOLDER_ORIGIN);
  } catch {
    return fallback;
  }
  if (parsed.origin !== PLACEHOLDER_ORIGIN) return fallback;

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
