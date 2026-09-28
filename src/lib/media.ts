/**
 * Banner media: the organiser's own images, and YouTube links.
 *
 * Pure, so the YouTube parsing can be tested against the eight URL shapes
 * people actually paste without opening a browser. That matters more than it
 * sounds: an organiser pastes whatever the share sheet on their phone gave
 * them, and a link that silently doesn't render is indistinguishable, to
 * them, from the feature being broken.
 */

export type GalleryItem = { kind: "image" | "youtube"; url: string };
export type Sponsor = { name: string; logoUrl: string; url?: string | null };

/** How many slides a hero can hold before it stops being a hero. */
export const MAX_GALLERY = 8;
export const MAX_SPONSORS = 12;

const ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * The video id out of any YouTube URL a person is likely to paste.
 *
 * Handles the share-sheet short link, the desktop watch URL with its pile of
 * tracking parameters, an embed URL somebody copied from another site, a
 * Shorts link, and a live link. Returns null for anything else — including a
 * playlist with no video in it, which would otherwise embed as an error.
 */
export function youtubeId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  // Somebody pasted just the id.
  if (ID.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\.|^m\./, "").toLowerCase();

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return ID.test(id) ? id : null;
  }

  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;

  const v = url.searchParams.get("v");
  if (v && ID.test(v)) return v;

  // /embed/ID, /shorts/ID, /live/ID, /v/ID
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length >= 2 && ["embed", "shorts", "live", "v"].includes(parts[0])) {
    return ID.test(parts[1]) ? parts[1] : null;
  }

  return null;
}

/**
 * Privacy-mode embed URL.
 *
 * youtube-nocookie, and no autoplay: a video that starts talking by itself
 * when somebody opens an event page is a reason to close the tab.
 */
export function youtubeEmbedUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`;
}

/** The still frame, used until somebody actually presses play. */
export function youtubeThumbUrl(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/**
 * The slides a hero should show, cover art first.
 *
 * The cover is slide one whether or not a gallery exists — it is the image
 * the event is already known by from the discovery rails, and opening a page
 * to a different picture than the card you tapped is disorienting.
 *
 * Unparseable YouTube links are dropped rather than rendered as a blank
 * frame. Duplicates go too: pasting the same link twice is a slip, and a
 * carousel that shows the same photo back to back looks broken.
 */
export function bannerSlides(
  cover: string | null | undefined,
  gallery: GalleryItem[] | null | undefined
): GalleryItem[] {
  const out: GalleryItem[] = [];
  const seen = new Set<string>();

  const push = (item: GalleryItem) => {
    const key = `${item.kind}:${item.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };

  if (cover) push({ kind: "image", url: cover });

  for (const item of gallery ?? []) {
    if (!item || typeof item.url !== "string" || !item.url.trim()) continue;

    if (item.kind === "youtube") {
      const id = youtubeId(item.url);
      if (!id) continue;
      push({ kind: "youtube", url: id });
      continue;
    }

    push({ kind: "image", url: item.url.trim() });
  }

  return out.slice(0, MAX_GALLERY + 1);
}

/**
 * Whether a URL is safe to put in an href or an src.
 *
 * `z.string().url()` is NOT this check. It asks whether a string parses as a
 * URL, and `javascript:alert(1)` parses perfectly — which means every field
 * validated with `.url()` alone will happily store a script, and every page
 * that renders it as a link will happily run it. Found by posting exactly
 * that to a live event and watching it come back 200.
 *
 * So: an explicit allowlist of two schemes, checked at the API on the way in
 * AND at every render site on the way out. Belt and braces on purpose — these
 * fields are typed by one person and displayed to hundreds, and a value that
 * predates this check, or arrives by a path nobody thought about, still must
 * not become a link somebody can click.
 */
export function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const { protocol } = new URL(trimmed);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** The URL if it is safe to render, otherwise null. Use at every render site. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  return isSafeHttpUrl(value) ? value.trim() : null;
}
