"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { safeInternalUrl, timeAgo, type BellItem } from "@/components/notification-bell";

/** The full notifications page: newest first, 20 at a time. */
export function NotificationList() {
  const router = useRouter();
  const [items, setItems] = useState<BellItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (after: string | null) => {
    const url = after ? `/api/notifications?cursor=${encodeURIComponent(after)}` : "/api/notifications";
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Couldn't load notifications.");
    return data as { enabled: boolean; unread: number; items: BellItem[]; nextCursor: string | null };
  }, []);

  useEffect(() => {
    let cancelled = false;
    load(null)
      .then((data) => {
        if (cancelled) return;
        setEnabled(data.enabled);
        setItems(data.items);
        setCursor(data.nextCursor);
        setUnread(data.unread);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load notifications."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function more() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const data = await load(cursor);
      setItems((list) => [...list, ...data.items]);
      setCursor(data.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load more.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function mark(body: { ids: string[] } | { all: true }) {
    const res = await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = res?.ok ? await res.json() : null;
    if (data) setUnread(Number(data.unread) || 0);
  }

  function open(item: BellItem) {
    if (!item.read) {
      setItems((list) => list.map((i) => (i.id === item.id ? { ...i, read: true } : i)));
      setUnread((n) => Math.max(0, n - 1));
      void mark({ ids: [item.id] });
    }
    const url = safeInternalUrl(item.url);
    if (url) router.push(url);
  }

  function markAll() {
    setItems((list) => list.map((i) => ({ ...i, read: true })));
    setUnread(0);
    void mark({ all: true });
  }

  if (loading) return <p className="py-10 text-center text-ink-2">Loading…</p>;
  if (!enabled) {
    return <p className="rounded-2xl border border-line bg-card px-5 py-8 text-center text-ink-2">Notifications aren&apos;t switched on yet.</p>;
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-ink-2">{unread > 0 ? `${unread} unread` : "All caught up"}</p>
        {unread > 0 && (
          <button type="button" onClick={markAll} className="rounded-lg px-3 py-2 text-sm font-semibold text-purple hover:bg-cream-2">
            Mark all read
          </button>
        )}
      </div>
      {error && <p className="mb-3 text-sm text-coral">{error}</p>}
      {items.length === 0 ? (
        <p className="rounded-2xl border border-line bg-card px-5 py-10 text-center text-ink-2">
          Nothing yet. New sales, payouts and alerts will show up here.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-line bg-card">
          {items.map((item) => (
            <li key={item.id} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => open(item)}
                className={`flex w-full gap-3 px-4 py-4 text-left transition-colors hover:bg-cream-2 ${item.read ? "" : "bg-purple/5"}`}
              >
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.read ? "bg-transparent" : "bg-purple"}`} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className={`block ${item.read ? "font-medium" : "font-bold"} text-ink`}>{item.title}</span>
                  {item.body && <span className="mt-0.5 block text-sm text-ink-2">{item.body}</span>}
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
      {cursor && (
        <button
          type="button"
          onClick={more}
          disabled={loadingMore}
          className="mt-4 w-full rounded-xl border border-line bg-card py-3 font-semibold text-ink hover:border-ink-3 disabled:opacity-60"
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
