import { put } from "@vercel/blob";

/**
 * Cover-image storage.
 *
 * Kept behind this module so the rest of the app never imports a vendor SDK
 * directly — swapping Vercel Blob for anything else later is one file.
 *
 * Uploads are possible with either a legacy read-write token or Vercel's
 * project-connected OIDC credentials. When neither is available, callers get
 * a clear, actionable failure rather than a silent one:
 * an event with no image is a real state the UI has to handle anyway, and
 * pretending an upload worked is worse than saying it did not.
 */

export const COVER_MAX_BYTES = 6 * 1024 * 1024; // 6MB

export const COVER_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

export function storageConfigured(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN)
  );
}

export { isOptimizable, BLOB_HOST_SUFFIX } from "./image-url";

export async function putEventCover(
  file: File,
  eventHint: string
): Promise<{ url: string }> {
  const ext = COVER_TYPES[file.type];
  if (!ext) throw new Error("Unsupported image type");

  const safeHint = eventHint.replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "event";
  const blob = await put(`covers/${safeHint}.${ext}`, file, {
    access: "public",
    addRandomSuffix: true,
    contentType: file.type,
  });

  return { url: blob.url };
}
