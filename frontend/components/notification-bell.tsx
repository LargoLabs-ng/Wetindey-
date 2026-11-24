"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";

/**
 * The bell in the dashboard and admin headers.
 *
 * Phone first: on a phone the panel opens full width just under the header;
 * on wider screens it's a dropdown beside the bell. It checks the unread
 * count every minute and whenever the tab comes back into view, and loads
 * the latest notifications only when opened.
 *
 * Hides itself entirely while notifications are switched off.
 */

export type BellItem = {
  id: string;
  title: string;
  body: string | null;
  url: string | null;
  read: boolean;
  createdAt: string;
};

export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short" });
}

/** Only follow links to pages on this site. */
export function safeInternalUrl(url: string | null): string | null {
  if (!url || !url.startsWith("/") || url.startsWith("//") || url.includes("\\")) return null;
  return url;
}

const POLL_MS = 60_000;

export function NotificationBell({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<BellItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panelTop, setPanelTop] = useState(64);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  /** Fetches the unread count; returns null when it couldn't. */
  const fetchCount = useCallback(async (): Promise<{ enabled: boolean; unread: number } | null> => {
    try {
      const res = await fetch("/api/notifications?countOnly=1", { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json();
      return { enabled: Boolean(data.enabled), unread: Number(data.unread) || 0 };
    } catch {
      return null; // Offline for a moment: try again next time.
    }
  }, []);

  const loadItems = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/notifications?limit=8", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't load notifications.");
      setItems(data.items ?? []);
      setUnread(Number(data.unread) || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load notifications.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const result = await fetchCount();
      if (cancelled || !result) return;
      setEnabled(result.enabled);
      setUnread(result.unread);
    };
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchCount]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markRead(body: { ids: string[] } | { all: true }) {
    try {
      const res = await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) setUnread(Number(data.unread) || 0);
    } catch {
      // The next refresh will show the true count.
    }
  }

  async function openItem(item: BellItem) {
    if (!item.read) {
      setItems((list) => list?.map((i) => (i.id === item.id ? { ...i, read: true } : i)) ?? null);
      setUnread((n) => Math.max(0, n - 1));
      void markRead({ ids: [item.id] });
    }
    const url = safeInternalUrl(item.url);
    setOpen(false);
    if (url) router.push(url);
  }

  async function markAll() {
    setItems((list) => list?.map((i) => ({ ...i, read: true })) ?? null);
    setUnread(0);
    await markRead({ all: true });
  }

  if (!enabled) return null;

  const dark = tone === "dark";
  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          // On phones the panel is pinned just under the bell, wherever the
          // header puts it (the dashboard header is taller on phones).
          const rect = buttonRef.current?.getBoundingClientRect();
          if (rect) setPanelTop(Math.round(rect.bottom + 8));
          // Load the latest when opening (not on every count refresh).
          if (!open) void loadItems();
          setOpen(!open);
        }}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`relative flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
          dark ? "text-on-dark-2 hover:bg-surface hover:text-on-dark" : "text-ink-2 hover:bg-cream-2 hover:text-ink"
        }`}
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unread > 0 && (
          <span
            className="absolute right-1 top-1 flex min-w-[18px] items-center justify-center rounded-full bg-coral px-1 text-[11px] font-bold leading-[18px] text-white"
            aria-hidden="true"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Notifications"
          style={{ ["--bell-top" as string]: `${panelTop}px` }}
          className="fixed inset-x-0 top-[var(--bell-top)] z-50 mx-2 max-h-[75vh] overflow-hidden rounded-2xl border border-line bg-card text-ink shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:mx-0 sm:w-[380px]"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-base font-bold">Notifications</h2>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAll}
                className="rounded-lg px-2 py-1 text-sm font-semibold text-purple hover:bg-cream-2"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[calc(75vh-104px)] overflow-y-auto">
            {error && <p className="px-4 py-6 text-sm text-coral">{error}</p>}
            {!error && items === null && <p className="px-4 py-6 text-sm text-ink-2">Loading…</p>}
            {!error && items?.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-ink-2">
                Nothing yet. New sales, payouts and alerts will show up here.
              </p>
            )}
            {items && items.length > 0 && (
              <ul>
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => openItem(item)}
                      className={`flex w-full gap-3 border-b border-line px-4 py-3 text-left transition-colors hover:bg-cream-2 ${
                        item.read ? "" : "bg-purple/5"
                      }`}
                    >
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.read ? "bg-transparent" : "bg-purple"}`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm ${item.read ? "font-medium" : "font-bold"}`}>
                          {item.title}
                        </span>
                        {item.body && (
                          <span className="mt-0.5 line-clamp-2 block text-sm text-ink-2">{item.body}</span>
                        )}
                        <span className="mt-1 block text-xs text-ink-3">
                          {timeAgo(item.createdAt)}
                          {!item.read && <span className="sr-only"> · unread</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-line px-4 py-3 text-center text-sm font-semibold text-purple hover:bg-cream-2"
          >
            See all notifications
          </Link>
          <Link
            href="/profile/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-line px-4 py-2.5 text-center text-xs font-semibold text-ink-2 hover:bg-cream-2"
          >
            Notification settings
          </Link>
        </div>
      )}
    </div>
  );
}
