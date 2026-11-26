"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";

/**
 * Pick an organisation logo: tap the square to upload, tap again to
 * replace. Uploads straight away and hands back the link, so the form that
 * holds it only ever deals in a URL.
 *
 * `tone` because it sits on two backgrounds: the light setup screen and
 * the dark dashboard.
 */
export function OrgLogoPicker({
  value,
  onChange,
  tone = "light",
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  tone?: "light" | "dark";
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dark = tone === "dark";

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/upload/org-logo", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      onChange(data.url as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      <div className="flex items-center gap-4">
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          aria-label={value ? "Replace logo" : "Upload logo"}
          className={`flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-dashed transition-colors disabled:opacity-60 ${
            dark
              ? "border-line-dark bg-canvas hover:border-purple"
              : "border-line bg-white hover:border-purple"
          }`}
        >
          {busy ? (
            <Loader2 className="h-6 w-6 animate-spin text-purple" />
          ) : value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="h-full w-full object-contain p-1" />
          ) : (
            <ImagePlus className={`h-6 w-6 ${dark ? "text-on-dark-3" : "text-ink-2"}`} />
          )}
        </button>
        <div className="min-w-0 text-sm">
          <p className={dark ? "text-on-dark-2" : "text-ink-2"}>
            Square works best. JPEG, PNG, WebP or AVIF, up to 6MB.
          </p>
          {value && !busy && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className={`mt-1 text-xs font-semibold ${
                dark ? "text-on-dark-3 hover:text-coral" : "text-ink-2 hover:text-coral"
              }`}
            >
              Remove
            </button>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-coral">{error}</p>}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
        }}
      />
    </div>
  );
}
