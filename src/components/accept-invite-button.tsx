"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/team/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't accept this invitation.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        onClick={accept}
        disabled={busy}
        className="w-full rounded-lg bg-forest text-ivory font-semibold py-2.5 hover:bg-emerald transition-colors disabled:opacity-60"
      >
        {busy ? "Joining…" : "Accept invitation"}
      </button>
      {error && <p className="text-error text-sm">{error}</p>}
    </div>
  );
}
