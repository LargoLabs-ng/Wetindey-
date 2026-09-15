"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";

/**
 * Cover art picker.
 *
 * Wetin Dey is an image-led product — a discovery rail of events with no
 * artwork is a dead rail — so this is deliberately the most prominent field
 * on the form, and it shows the real image back immediately rather than a
 * filename.
 */
export function CoverImageField({
  value,
  onChange,
  eventId,
  slugHint,
  tone = "dark",
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  /** Present when editing an existing event; absent when creating. */
  eventId?: string;
  slugHint?: string;
  tone?: "dark" | "light";
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const dark = tone === "dark";

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      if (eventId) body.append("eventId", eventId);
      if (slugHint) body.append("slug", slugHint);

      const res = await fetch("/api/upload/event-cover", { method: "POST", body });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "Upload failed. Try again.");
        return;
      }
      onChange(data.url);
    } catch {
      setError("Upload failed — check your connection and try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  function pick(file: File | undefined) {
    if (file) void upload(file);
  }

  return (
    <div>
      <label
        className={`mb-1 block text-sm font-medium ${
          dark ? "text-on-dark-2" : "text-ink-2"
        }`}
      >
        Cover art
      </label>

      {value ? (
        <div className="relative overflow-hidden rounded-xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Event cover"
            className="aspect-[16/9] w-full max-w-full object-cover"
          />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-lg bg-black/70 px-2.5 py-1.5 text-xs font-semibold text-white backdrop-blur hover:bg-black/85"
          >
            <X className="h-3.5 w-3.5" />
            Replace
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files?.[0]);
          }}
          disabled={busy}
          className={`flex aspect-[16/9] w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed transition-colors disabled:opacity-60 ${
            dragging
              ? "border-purple bg-purple-dim"
              : dark
                ? "border-line-dark bg-canvas hover:border-purple"
                : "border-line bg-cream-2 hover:border-purple"
          }`}
        >
          {busy ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-purple" />
              <span className={`text-sm ${dark ? "text-on-dark-2" : "text-ink-2"}`}>
                Uploading…
              </span>
            </>
          ) : (
            <>
              <ImagePlus className={`h-7 w-7 ${dark ? "text-on-dark-3" : "text-ink-3"}`} />
              <span className={`text-sm font-medium ${dark ? "text-on-dark" : "text-ink"}`}>
                Add cover art
              </span>
              <span className={`text-xs ${dark ? "text-on-dark-3" : "text-ink-3"}`}>
                Drop an image or click to browse · JPEG, PNG or WebP up to 6MB
              </span>
            </>
          )}
        </button>
      )}

      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />

      {error && <p className="mt-2 text-sm text-coral">{error}</p>}

      {!value && !error && (
        <p className={`mt-2 text-xs ${dark ? "text-on-dark-3" : "text-ink-3"}`}>
          Events without art get scrolled past. A flyer or a photo from last
          year both work.
        </p>
      )}
    </div>
  );
}
