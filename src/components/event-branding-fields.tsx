"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Play, Trash2 } from "lucide-react";
import {
  MAX_GALLERY,
  MAX_SPONSORS,
  youtubeId,
  youtubeThumbUrl,
  type GalleryItem,
  type Sponsor,
} from "@/lib/media";

/**
 * Logo, banner gallery and sponsors.
 *
 * All three are "who is putting this on", which is why they sit together
 * rather than beside the cover art. The cover is about the event; these are
 * about the organiser, and they outlive any one party.
 */

const field =
  "w-full rounded-lg border border-line-dark bg-canvas px-3 py-2 text-on-dark placeholder:text-on-dark-3 focus:outline-none focus:ring-2 focus:ring-purple";
const caption = "mb-1 block text-xs font-medium text-on-dark-2";

async function uploadImage(file: File, eventId: string): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  body.append("eventId", eventId);
  const res = await fetch("/api/upload/event-cover", { method: "POST", body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Upload failed.");
  return data.url as string;
}

/** A square image slot: click to upload, click again to replace. */
function ImageSlot({
  value,
  onChange,
  eventId,
  label,
  onError,
}: {
  value: string | null;
  onChange: (url: string) => void;
  eventId: string;
  label: string;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-line-dark bg-canvas transition-colors hover:border-purple disabled:opacity-60"
        aria-label={label}
      >
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin text-purple" />
        ) : value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-full w-full object-contain" />
        ) : (
          <ImagePlus className="h-5 w-5 text-on-dark-3" />
        )}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          try {
            onChange(await uploadImage(file, eventId));
          } catch (err) {
            onError(err instanceof Error ? err.message : "Upload failed.");
          } finally {
            setBusy(false);
            if (input.current) input.current.value = "";
          }
        }}
      />
    </>
  );
}

export function EventBrandingFields({ eventId }: { eventId: string }) {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [youtubeInput, setYoutubeInput] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const galleryInput = useRef<HTMLInputElement>(null);
  const [addingImage, setAddingImage] = useState(false);

  const touch = () => setSaved(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/events/${eventId}`);
        if (!res.ok) throw new Error("Could not load this event.");
        const data = await res.json();
        const ev = data.event ?? data;
        if (cancelled) return;
        setLogoUrl(ev.logoUrl ?? null);
        setGallery(Array.isArray(ev.gallery) ? ev.gallery : []);
        setSponsors(Array.isArray(ev.sponsors) ? ev.sponsors : []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Load failed.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  function addYoutube() {
    const id = youtubeId(youtubeInput);
    if (!id) {
      setError("That doesn't look like a YouTube link.");
      return;
    }
    setError(null);
    setYoutubeInput("");
    touch();
    setGallery((g) => [...g, { kind: "youtube", url: `https://youtu.be/${id}` }]);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/events/${eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        logoUrl: logoUrl ?? "",
        gallery,
        // A sponsor with no name or no logo is a half-finished row the
        // organiser abandoned; dropping it here beats an error telling them
        // to go and find it.
        sponsors: sponsors.filter((s) => s.name.trim() && s.logoUrl),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "Could not save.");
      return;
    }
    setSaved(true);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-on-dark-2">
        <Loader2 className="h-4 w-4 animate-spin text-purple" />
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-bold text-on-dark">Your branding</h3>
        <p className="mt-1 text-sm text-on-dark-2">
          The cover art above is this event&apos;s flyer. Everything here is
          yours — it stays the same whichever party you&apos;re throwing.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-coral/40 bg-coral/10 px-3 py-2 text-sm text-coral">
          {error}
        </p>
      )}

      {/* ── Logo ─────────────────────────────────────────────────────── */}
      <div>
        <label className={caption}>Your logo</label>
        <div className="flex items-center gap-3">
          <ImageSlot
            value={logoUrl}
            onChange={(url) => {
              setLogoUrl(url);
              touch();
            }}
            eventId={eventId}
            label="Upload your logo"
            onError={setError}
          />
          <div className="min-w-0">
            <p className="text-sm text-on-dark-2">
              Shown beside your name on the event page, and on tickets.
            </p>
            {logoUrl && (
              <button
                type="button"
                onClick={() => {
                  setLogoUrl(null);
                  touch();
                }}
                className="mt-1 text-xs font-medium text-on-dark-3 hover:text-coral"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Gallery ──────────────────────────────────────────────────── */}
      <div>
        <label className={caption}>More banner images</label>
        <p className="mb-2 text-sm text-on-dark-2">
          These rotate at the top of your event page, after the cover. A
          YouTube link works too — it shows as a still until someone presses
          play.
        </p>

        {gallery.length > 0 && (
          <ul className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {gallery.map((item, i) => {
              const id = item.kind === "youtube" ? youtubeId(item.url) : null;
              return (
                <li
                  key={`${item.kind}-${item.url}-${i}`}
                  className="relative aspect-[4/3] overflow-hidden rounded-lg border border-line-dark bg-canvas"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={id ? youtubeThumbUrl(id) : item.url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                  {item.kind === "youtube" && (
                    // `Youtube` isn't in this version of lucide-react. A play
                    // badge says the same thing and doesn't put a brand mark
                    // on the organiser's own gallery.
                    <span className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70">
                      <Play className="ml-px h-2.5 w-2.5 fill-white text-white" />
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setGallery((g) => g.filter((_, x) => x !== i));
                      touch();
                    }}
                    className="absolute right-1 top-1 rounded-md bg-black/70 p-1 text-white hover:bg-black/90"
                    aria-label="Remove this item"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={addingImage || gallery.length >= MAX_GALLERY}
            onClick={() => galleryInput.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line-dark px-3 py-2 text-sm font-semibold text-on-dark-2 transition-colors hover:text-on-dark disabled:opacity-40"
          >
            {addingImage ? (
              <Loader2 className="h-4 w-4 animate-spin text-purple" />
            ) : (
              <ImagePlus className="h-4 w-4" />
            )}
            Add image
          </button>
          <input
            ref={galleryInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setAddingImage(true);
              setError(null);
              try {
                const url = await uploadImage(file, eventId);
                setGallery((g) => [...g, { kind: "image", url }]);
                touch();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Upload failed.");
              } finally {
                setAddingImage(false);
                if (galleryInput.current) galleryInput.current.value = "";
              }
            }}
          />

          <input
            value={youtubeInput}
            onChange={(e) => setYoutubeInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addYoutube();
              }
            }}
            placeholder="Paste a YouTube link"
            className={`${field} sm:w-64`}
          />
          <button
            type="button"
            disabled={!youtubeInput.trim() || gallery.length >= MAX_GALLERY}
            onClick={addYoutube}
            className="rounded-lg border border-line-dark px-3 py-2 text-sm font-semibold text-on-dark-2 transition-colors hover:text-on-dark disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>

      {/* ── Sponsors ─────────────────────────────────────────────────── */}
      <div>
        <label className={caption}>Sponsors and partners</label>
        <p className="mb-2 text-sm text-on-dark-2">
          Shown as a strip near the bottom of the event page. A name and a
          logo; the link is optional.
        </p>

        <div className="space-y-2">
          {sponsors.map((s, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-xl border border-line-dark bg-canvas/40 p-3"
            >
              <ImageSlot
                value={s.logoUrl || null}
                onChange={(url) => {
                  setSponsors((list) =>
                    list.map((x, j) => (j === i ? { ...x, logoUrl: url } : x))
                  );
                  touch();
                }}
                eventId={eventId}
                label={`Upload logo for sponsor ${i + 1}`}
                onError={setError}
              />
              <div className="min-w-0 flex-1 space-y-2">
                <input
                  value={s.name}
                  onChange={(e) => {
                    setSponsors((list) =>
                      list.map((x, j) =>
                        j === i ? { ...x, name: e.target.value } : x
                      )
                    );
                    touch();
                  }}
                  placeholder="Sponsor or partner name"
                  className={field}
                />
                <input
                  value={s.url ?? ""}
                  onChange={(e) => {
                    setSponsors((list) =>
                      list.map((x, j) =>
                        j === i ? { ...x, url: e.target.value } : x
                      )
                    );
                    touch();
                  }}
                  placeholder="https://their-website.com (optional)"
                  className={field}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setSponsors((list) => list.filter((_, j) => j !== i));
                  touch();
                }}
                className="rounded-lg border border-line-dark p-2 text-on-dark-3 transition-colors hover:text-coral"
                aria-label={`Remove sponsor ${i + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          disabled={sponsors.length >= MAX_SPONSORS}
          onClick={() => {
            setSponsors((list) => [...list, { name: "", logoUrl: "", url: "" }]);
            touch();
          }}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-line-dark px-3 py-2 text-sm font-semibold text-on-dark-2 transition-colors hover:text-on-dark disabled:opacity-40"
        >
          + Add sponsor
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="rounded-lg bg-purple px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-purple-deep disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save branding"}
        </button>
        {saved && <span className="text-sm text-purple-lift">Saved.</span>}
      </div>
    </div>
  );
}
