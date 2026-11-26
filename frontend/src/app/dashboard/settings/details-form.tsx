"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { OrgLogoPicker } from "@/components/org-logo-picker";

const field =
  "w-full rounded-lg border border-line-dark bg-canvas px-3 py-2.5 text-on-dark placeholder:text-on-dark-3 focus:outline-none focus:ring-2 focus:ring-gold";
const label = "mb-1 block text-sm font-medium text-on-dark-2";

/** Name and logo. Saved together with one button. */
export function OrganizationDetailsForm({
  initialName,
  initialLogoUrl,
}: {
  initialName: string;
  initialLogoUrl: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoUrl);
  const [saved, setSaved] = useState({ name: initialName, logoUrl: initialLogoUrl });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = name.trim() !== saved.name || logoUrl !== saved.logoUrl;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, logoUrl: logoUrl ?? "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ ok: false, text: data.error ?? "Couldn't save. Try again." });
        return;
      }
      const next = {
        name: data.organization?.name ?? name.trim(),
        logoUrl: data.organization?.logoUrl ?? null,
      };
      setName(next.name);
      setLogoUrl(next.logoUrl);
      setSaved(next);
      setMessage({ ok: true, text: "Saved." });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "Network error — try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-5 rounded-2xl border border-line-dark bg-surface p-5">
      <h2 className="flex items-center gap-2 font-bold text-on-dark">
        <Building2 className="h-4 w-4 text-gold" />
        Your organisation
      </h2>

      <div>
        <label htmlFor="settings-org-name" className={label}>
          Name people know you by
        </label>
        <input
          id="settings-org-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          required
          className={field}
        />
      </div>

      <div>
        <span className={label}>Logo</span>
        <OrgLogoPicker value={logoUrl} onChange={setLogoUrl} tone="dark" />
        <p className="mt-2 text-xs text-on-dark-3">
          Shown on any event that doesn&apos;t have its own logo, and on tickets.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || !dirty}
          className="rounded-lg bg-gold px-4 py-2.5 font-semibold text-canvas transition-colors hover:bg-gold-deep disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
        {message && (
          <p role="status" className={`text-sm ${message.ok ? "text-sage" : "text-coral"}`}>
            {message.text}
          </p>
        )}
      </div>
    </form>
  );
}
