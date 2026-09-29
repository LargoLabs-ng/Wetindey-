import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { eventBans, eventMessages, eventUpdates, events } from "@/db/schema";
import {
  getSessionUserId,
  isUuid,
  requireEventCapability,
} from "@/lib/authz";

type RouteContext = { params: Promise<{ id: string }> };

/** What a reader is shown for a message that was taken down. */
type Tombstone = { removedBy: "author" | "organiser" };

/**
 * Display name for a conversation.
 *
 * Deliberately not the email address. A student asking "is it free for
 * 200 level?" under their full email, on a page anyone with the link can
 * read, is a privacy problem we would have created ourselves.
 */
function displayName(user: {
  firstName: string | null;
  lastName: string | null;
  name: string | null;
} | null): string {
  if (!user) return "Someone";
  const parts = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return parts || user.name?.trim() || "Someone";
}

/**
 * GET /api/events/:id/conversation
 *
 * Public: reading an event's thread needs no account, the same way reading
 * the event does. Posting does.
 *
 * Messages that were taken down come back as tombstones rather than
 * vanishing. Deleting them outright would silently reshape a thread — a
 * reply left hanging under nothing, a reported message that appears never to
 * have existed.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Unknown event." }, { status: 400 });
  }

  // The client is told what it may do rather than guessing. Without this the
  // page has to infer "am I the organiser?" from somewhere else and will
  // eventually infer it wrongly — showing a hide button to someone the API
  // then refuses, or hiding one from someone who needs it.
  const viewerId = await getSessionUserId();
  const moderator = await requireEventCapability(id, "event:edit");

  const [messages, updates] = await Promise.all([
    db.query.eventMessages.findMany({
      where: eq(eventMessages.eventId, id),
      orderBy: asc(eventMessages.createdAt),
      with: { author: true },
      limit: 300,
    }),
    db.query.eventUpdates.findMany({
      where: eq(eventUpdates.eventId, id),
      orderBy: desc(eventUpdates.createdAt),
      with: { author: true },
      limit: 50,
    }),
  ]);

  const shaped = messages.map((m) => {
    const down: Tombstone | null =
      m.status === "visible"
        ? null
        : { removedBy: m.status === "removed" ? "author" : "organiser" };

    // A moderator keeps seeing what they hid. Hiding something and then
    // being unable to read it makes the decision impossible to review and
    // the unhide button impossible to use with any confidence.
    const readable = !down || (moderator.ok && m.status === "hidden");

    return {
      id: m.id,
      parentId: m.parentId,
      // A withdrawn message keeps its shape in the thread and loses its
      // content and its author. Both are the point of withdrawing it.
      body: readable ? m.body : null,
      author: readable ? displayName(m.author) : null,
      authorId: readable ? m.authorId : null,
      createdAt: m.createdAt,
      down,
    };
  });

  return NextResponse.json({
    viewerId,
    canModerate: moderator.ok,
    messages: shaped,
    updates: updates.map((u) => ({
      id: u.id,
      body: u.body,
      author: displayName(u.author),
      createdAt: u.createdAt,
    })),
  });
}

const postSchema = z.object({
  body: z.string().trim().min(1).max(1000),
  parentId: z.string().uuid().optional(),
});

/**
 * Best-effort throttle, in memory and per server instance. Enough to stop
 * someone pasting the same thing twenty times; not a substitute for a real
 * rate limiter the day this needs one.
 */
const lastPost = new Map<string, number>();
const COOLDOWN_MS = 10_000;

/** POST /api/events/:id/conversation — ask a question or reply to one. */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Unknown event." }, { status: 400 });
  }

  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { error: "Sign in to join the conversation." },
      { status: 401 }
    );
  }

  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Say something between 1 and 1000 characters." },
      { status: 400 }
    );
  }

  const event = await db.query.events.findFirst({ where: eq(events.id, id) });
  if (!event || event.status !== "published") {
    return NextResponse.json({ error: "Unknown event." }, { status: 404 });
  }

  // Checked before anything is written. An organiser who blocked someone
  // should not have to watch them keep posting.
  const banned = await db.query.eventBans.findFirst({
    where: and(eq(eventBans.eventId, id), eq(eventBans.userId, userId)),
  });
  if (banned) {
    return NextResponse.json(
      { error: "You can't post on this event." },
      { status: 403 }
    );
  }

  const key = `${userId}:${id}`;
  if (Date.now() - (lastPost.get(key) ?? 0) < COOLDOWN_MS) {
    return NextResponse.json(
      { error: "Give it a few seconds before posting again." },
      { status: 429 }
    );
  }

  // Replies go one level deep. A reply to a reply attaches to the same
  // question instead, which keeps the thread readable and keeps the client
  // from having to render arbitrary nesting.
  let parentId: string | null = null;
  if (parsed.data.parentId) {
    const parent = await db.query.eventMessages.findFirst({
      where: and(
        eq(eventMessages.id, parsed.data.parentId),
        eq(eventMessages.eventId, id)
      ),
    });
    if (!parent) {
      return NextResponse.json(
        { error: "That message is no longer there." },
        { status: 404 }
      );
    }
    parentId = parent.parentId ?? parent.id;
  }

  lastPost.set(key, Date.now());

  const [created] = await db
    .insert(eventMessages)
    .values({ eventId: id, authorId: userId, parentId, body: parsed.data.body })
    .returning();

  return NextResponse.json({ id: created.id }, { status: 201 });
}
