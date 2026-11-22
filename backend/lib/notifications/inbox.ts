/**
 * The in-app inbox, as the bell and the notifications page read it.
 *
 * Every function takes the signed-in user's id from the server session and
 * filters by it. Ids in a request never decide whose rows are read or
 * changed: asking to mark someone else's notification read changes nothing.
 */
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";

export type InboxItem = {
  id: string;
  type: string;
  category: string;
  title: string;
  body: string | null;
  url: string | null;
  read: boolean;
  createdAt: string;
};

export const PAGE_SIZE = 20;

/** Cursor = "<createdAt ISO>|<id>": stable even when two rows share a timestamp. */
function decodeCursor(cursor: string | null): { at: Date; id: string } | null {
  if (!cursor) return null;
  const [at, id] = cursor.split("|");
  const date = new Date(at);
  if (!id || Number.isNaN(date.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { at: date, id };
}

export async function listInbox(
  userId: string,
  options: { cursor?: string | null; limit?: number } = {}
): Promise<{ items: InboxItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? PAGE_SIZE, 1), 50);
  const after = decodeCursor(options.cursor ?? null);
  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      category: notifications.category,
      title: notifications.title,
      body: notifications.body,
      url: notifications.url,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        after
          ? or(
              lt(notifications.createdAt, after.at),
              and(eq(notifications.createdAt, after.at), lt(notifications.id, after.id))
            )
          : undefined
      )
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({
      id: r.id,
      type: r.type,
      category: r.category,
      title: r.title,
      body: r.body,
      url: r.url,
      read: r.readAt !== null,
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor: rows.length > limit && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
  };
}

export async function unreadCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.count ?? 0;
}

/** Marks the given ids read — only those that belong to `userId`. */
export async function markRead(userId: string, ids: string[]): Promise<number> {
  const clean = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 100);
  if (clean.length === 0) return 0;
  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, userId),
        inArray(notifications.id, clean),
        isNull(notifications.readAt)
      )
    )
    .returning({ id: notifications.id });
  return updated.length;
}

export async function markAllRead(userId: string): Promise<number> {
  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return updated.length;
}
