"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyEventLink({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/events/${slug}`
      );
      setCopied(true);
      setError(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setError(true);
    }
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={copyLink}
        className="inline-flex items-center gap-2 rounded-lg border border-line-dark px-4 py-2 text-sm font-semibold text-on-dark transition-colors hover:border-gold hover:text-gold"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copied ? "Copied!" : "Copy link"}
      </button>
      <span className="sr-only" aria-live="polite">
        {error ? "Could not copy the event link." : copied ? "Event link copied." : ""}
      </span>
    </div>
  );
}
