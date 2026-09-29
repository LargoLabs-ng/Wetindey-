/**
 * Client-safe image helpers. No SDK imports — this module gets bundled into
 * the browser, so anything server-only belongs in lib/storage.ts instead.
 */

/** Host next/image is allowed to optimise. Keep in sync with next.config.ts. */
export const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

/**
 * True when next/image can safely handle this URL.
 *
 * Cover images used to be pasted in as arbitrary URLs while next.config had
 * no remotePatterns at all, so <Image> threw "hostname is not configured"
 * and took the page down. Rather than allow every host on the internet —
 * which turns the image optimizer into an open proxy — anything that isn't
 * our own storage renders through a plain <img>.
 */
export function isOptimizable(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(BLOB_HOST_SUFFIX);
  } catch {
    return url.startsWith("/"); // app-relative assets are fine
  }
}
