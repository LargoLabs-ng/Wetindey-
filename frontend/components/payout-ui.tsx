"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, X } from "lucide-react";

/**
 * Small pieces shared by the admin Payouts screens. Styled with the admin
 * console's own tokens (ivory, forest, stone, purple) and built for a phone
 * first: the confirm sheet slides up from the bottom and only becomes a
 * centred dialog on wider screens.
 */

export const border = { borderColor: "var(--color-line)" } as const;
export const card = "rounded-xl border bg-white p-4 sm:p-5";

export function naira(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  return `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function shortDate(value: string | Date | null | undefined, withTime = false): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

/** Admin words for each status. */
export const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  pending: { label: "Pending", bg: "var(--color-warn-soft)", fg: "var(--color-warn)" },
  approved: { label: "Approved", bg: "var(--color-purple-soft)", fg: "var(--color-purple)" },
  processing: { label: "Being sent", bg: "var(--color-ivory-2)", fg: "var(--color-indigo)" },
  paid: { label: "Paid", bg: "var(--color-ok-soft)", fg: "var(--color-success)" },
  failed: { label: "Transfer failed", bg: "var(--color-danger-soft)", fg: "var(--color-danger)" },
  rejected: { label: "Rejected", bg: "var(--color-ivory-3)", fg: "var(--color-stone)" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, bg: "var(--color-ivory-3)", fg: "var(--color-stone)" };
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-bold"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

/** Copies text, with a fallback for browsers that block the clipboard API. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "absolute";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
    }
    setCopied(true);
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={label}
      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold"
      style={{ ...border, color: copied ? "var(--color-success)" : "var(--color-purple)" }}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** A bottom sheet on phones, a centred dialog from `sm` up. */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-bold" style={{ color: "var(--color-forest)" }}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-m-2 rounded-lg p-2"
            style={{ color: "var(--color-stone)" }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Banner({ tone, children }: { tone: "ok" | "error" | "warn"; children: ReactNode }) {
  const style =
    tone === "ok"
      ? { backgroundColor: "var(--color-ok-soft)", color: "var(--color-success)" }
      : tone === "warn"
        ? { backgroundColor: "var(--color-warn-soft)", color: "var(--color-warn)" }
        : { backgroundColor: "var(--color-danger-soft)", color: "var(--color-danger)" };
  return (
    <div role={tone === "error" ? "alert" : "status"} className="rounded-lg px-3 py-2 text-sm" style={style}>
      {children}
    </div>
  );
}
