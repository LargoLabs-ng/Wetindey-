"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { EyeOff, Flag, MessageCircle, Megaphone, Undo2, UserX } from "lucide-react";

type Down = { removedBy: "author" | "organiser" };

type Message = {
  id: string;
  parentId: string | null;
  body: string | null;
  author: string | null;
  authorId: string | null;
  createdAt: string;
  down: Down | null;
};

type Update = {
  id: string;
  body: string;
  author: string;
  createdAt: string;
};

type Thread = {
  viewerId: string | null;
  canModerate: boolean;
  messages: Message[];
  updates: Update[];
};

const REASONS = [
  { value: "spam", label: "Spam" },
  { value: "abuse", label: "Abusive" },
  { value: "scam", label: "Scam" },
  { value: "off_topic", label: "Off topic" },
  { value: "other", label: "Something else" },
] as const;

function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
  });
}

/**
 * The event's conversation: organiser updates, then questions and answers.
 *
 * The brief's §11 puts moderation and posting in the same release, so every
 * control that creates content here ships beside a control that removes it.
 * Reading needs no account — the same as reading the event. Posting does,
 * because a report has to lead back to somebody.
 */
export function EventConversation({
  eventId,
  eventTitle,
}: {
  eventId: string;
  eventTitle: string;
}) {
  const { status } = useSession();
  const signedIn = status === "authenticated";

  const [thread, setThread] = useState<Thread | null>(null);
  const [body, setBody] = useState("");
  const [update, setUpdate] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/events/${eventId}/conversation`);
      if (!r.ok) return;
      setThread(await r.json());
    } catch {
      /* the section simply doesn't render rather than breaking the page */
    }
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  const post = async () => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/events/${eventId}/conversation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, parentId: replyTo ?? undefined }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(data.error ?? "Couldn't post that.");
        return;
      }
      setBody("");
      setReplyTo(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const postUpdate = async () => {
    const text = update.trim();
    if (!text) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/events/${eventId}/updates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (r.ok) {
        setUpdate("");
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const moderate = async (
    id: string,
    action: "hide" | "unhide" | "withdraw" | "block_author"
  ) => {
    setBusy(true);
    try {
      await fetch(`/api/messages/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const report = async (id: string, reason: string) => {
    setReporting(null);
    const r = await fetch(`/api/messages/${id}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const data = await r.json().catch(() => ({}));
    // Same acknowledgement whether this is a first report or a tenth. A
    // different message for a repeat would tell someone their report was
    // already counted, which is not information they need and not
    // information a bad actor should be able to probe for.
    setNotice(data.message ?? "Thanks — the organiser will take a look.");
    setTimeout(() => setNotice(null), 4000);
  };

  if (!thread) return null;

  const roots = thread.messages.filter((m) => !m.parentId);
  const repliesFor = (id: string) =>
    thread.messages.filter((m) => m.parentId === id);

  const Body = ({ m }: { m: Message }) => {
    if (m.body === null) {
      return (
        <p className="text-sm italic text-ink-3">
          {m.down?.removedBy === "author"
            ? "This message was withdrawn."
            : "This message was taken down."}
        </p>
      );
    }
    return (
      <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink">
        {m.body}
      </p>
    );
  };

  const Controls = ({ m }: { m: Message }) => {
    const mine = !!m.authorId && m.authorId === thread.viewerId;
    const hidden = m.down?.removedBy === "organiser";

    return (
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {signedIn && !m.down && !m.parentId && (
          <button
            type="button"
            onClick={() => setReplyTo(replyTo === m.id ? null : m.id)}
            className="font-semibold text-purple hover:underline"
          >
            {replyTo === m.id ? "Cancel" : "Reply"}
          </button>
        )}

        {mine && !m.down && (
          <button
            type="button"
            onClick={() => moderate(m.id, "withdraw")}
            disabled={busy}
            className="text-ink-3 hover:text-ink"
          >
            Delete
          </button>
        )}

        {signedIn && !mine && !m.down && (
          <button
            type="button"
            onClick={() => setReporting(reporting === m.id ? null : m.id)}
            className="inline-flex items-center gap-1 text-ink-3 hover:text-ink"
          >
            <Flag className="h-3 w-3" />
            Report
          </button>
        )}

        {thread.canModerate && m.body !== null && (
          <>
            <button
              type="button"
              onClick={() => moderate(m.id, hidden ? "unhide" : "hide")}
              disabled={busy}
              className="inline-flex items-center gap-1 text-ink-3 hover:text-ink"
            >
              {hidden ? <Undo2 className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              {hidden ? "Restore" : "Take down"}
            </button>
            {!mine && (
              <button
                type="button"
                onClick={() => moderate(m.id, "block_author")}
                disabled={busy}
                className="inline-flex items-center gap-1 text-ink-3 hover:text-coral"
              >
                <UserX className="h-3 w-3" />
                Block
              </button>
            )}
          </>
        )}

        {reporting === m.id && (
          <div className="mt-1 flex w-full flex-wrap gap-2">
            {REASONS.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => report(m.id, r.value)}
                className="rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-ink-2 hover:border-ink-3 hover:text-ink"
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* ── Organiser updates ──────────────────────────────────────────
          Above the Q&A, because "the venue has changed" is not a reply to
          anything and must not be something you scroll to find. */}
      {(thread.updates.length > 0 || thread.canModerate) && (
        <section className="mt-10">
          <h2 className="flex items-center gap-2 text-2xl font-extrabold tracking-[-0.03em] text-ink">
            <Megaphone className="h-5 w-5 text-coral" />
            Plug alert
          </h2>

          {/* The organiser's composer lives here rather than in the
              dashboard: an announcement is written while looking at the page
              the audience will read it on. */}
          {thread.canModerate && (
            <div className="mt-4">
              <textarea
                value={update}
                onChange={(e) => setUpdate(e.target.value)}
                rows={2}
                maxLength={1000}
                placeholder="Tell everyone something — a change of venue, doors opening, anything."
                className="w-full rounded-xl border border-line bg-card px-4 py-3 text-[15px] text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-purple"
              />
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={postUpdate}
                  disabled={busy || !update.trim()}
                  className="rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                  style={{ backgroundColor: "var(--color-coral-deep)" }}
                >
                  {busy ? "Posting…" : "Post update"}
                </button>
              </div>
            </div>
          )}

          <div className="mt-4 space-y-3">
            {thread.updates.map((u) => (
              <div
                key={u.id}
                className="rounded-xl p-4"
                style={{
                  backgroundColor: "var(--color-coral-soft)",
                  borderLeft: "3px solid var(--color-coral)",
                }}
              >
                <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink">
                  {u.body}
                </p>
                <p className="mt-2 text-xs text-ink-3">
                  {u.author} · {ago(u.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Q&A ────────────────────────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="flex items-center gap-2 text-2xl font-extrabold tracking-[-0.03em] text-ink">
          <MessageCircle className="h-5 w-5 text-purple" />
          People dey talk
        </h2>

        {roots.length === 0 && (
          <p className="mt-2 text-ink-2">
            No questions yet. Ask the organiser anything about {eventTitle} —
            dress code, transport, what time it really starts.
          </p>
        )}

        <div className="mt-5 space-y-6">
          {roots.map((m) => (
            <div key={m.id}>
              <div className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-white"
                  style={{ backgroundColor: "var(--color-purple)" }}
                >
                  {(m.author ?? "?").charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-ink">
                    {m.author ?? "Someone"}{" "}
                    <span className="font-normal text-ink-3">
                      · {ago(m.createdAt)}
                    </span>
                  </p>
                  <div className="mt-1">
                    <Body m={m} />
                  </div>
                  <Controls m={m} />
                </div>
              </div>

              {repliesFor(m.id).length > 0 && (
                <div className="mt-4 space-y-4 border-l border-line pl-4 sm:ml-11">
                  {repliesFor(m.id).map((r) => (
                    <div key={r.id}>
                      <p className="text-sm font-bold text-ink">
                        {r.author ?? "Someone"}{" "}
                        <span className="font-normal text-ink-3">
                          · {ago(r.createdAt)}
                        </span>
                      </p>
                      <div className="mt-1">
                        <Body m={r} />
                      </div>
                      <Controls m={r} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ── Composer ─────────────────────────────────────────────────── */}
        <div className="mt-6">
          {signedIn ? (
            <>
              {replyTo && (
                <p className="mb-2 text-xs font-semibold text-purple">
                  Replying to a question
                </p>
              )}
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder={replyTo ? "Write your reply…" : "Ask a question…"}
                className="w-full rounded-xl border border-line bg-card px-4 py-3 text-[15px] text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-purple"
              />
              {error && <p className="mt-2 text-sm text-coral">{error}</p>}
              <div className="mt-2 flex items-center justify-between gap-4">
                <span className="text-xs text-ink-3">
                  {body.length}/1000 · be nice, na your people dey here
                </span>
                <button
                  type="button"
                  onClick={post}
                  disabled={busy || !body.trim()}
                  className="rounded-xl bg-purple px-5 py-2.5 text-sm font-bold text-white hover:bg-purple-deep disabled:opacity-50"
                >
                  {busy ? "Posting…" : "Post"}
                </button>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-line bg-card p-4 text-sm text-ink-2">
              <Link href="/login" className="font-semibold text-purple hover:underline">
                Sign in
              </Link>{" "}
              to ask a question. You don&apos;t need an account to buy a ticket —
              only to talk here.
            </div>
          )}
        </div>

        {notice && (
          <p className="mt-3 text-sm font-semibold text-ok">{notice}</p>
        )}
      </section>
    </>
  );
}
