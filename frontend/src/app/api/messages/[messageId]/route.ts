import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { eventBans, eventMessages, messageReports } from "@/db/schema";
import {
  getSessionUserId,
  isPlatformAdmin,
  isUuid,
  requireEventCapability,
} from "@/lib/authz";

type RouteContext = { params: Promise<{ messageId: string }> };

const schema = z.object({
  action: z.enum(["hide", "unhide", "withdraw", "block_author"]),
  reason: z.string().trim().max(300).optional(),
});

/**
 * PATCH /api/messages/:messageId — the moderation surface.
 *
 * Four actions, two kinds of authority:
 *
 *   withdraw      the author taking their own message down
 *   hide/unhide   the organiser taking somebody else's down, reversibly
 *   block_author  the organiser stopping a repeat offender posting again
 *
 * Nothing here deletes a row. A moderation decision has to be reviewable,
 * and a reported message that can be made to disappear is a reported
 * message nobody can adjudicate.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { messageId } = await context.params;
  if (!isUuid(messageId)) {
    return NextResponse.json({ error: "Unknown message." }, { status: 400 });
  }

  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  const message = await db.query.eventMessages.findFirst({
    where: eq(eventMessages.id, messageId),
  });
  if (!message) {
    return NextResponse.json({ error: "Unknown message." }, { status: 404 });
  }

  // An author may take down their own message and nothing else — no hiding
  // other people's, no blocking anyone.
  if (parsed.data.action === "withdraw") {
    if (message.authorId !== userId) {
      return NextResponse.json(
        { error: "You can only take down your own message." },
        { status: 403 }
      );
    }
    await db
      .update(eventMessages)
      .set({ status: "removed", updatedAt: new Date() })
      .where(eq(eventMessages.id, messageId));
    return NextResponse.json({ ok: true });
  }

  // Everything else is the organiser's. Platform admins get the same reach,
  // because a report that only the reported event's own organiser can act on
  // is no use when the organiser is the problem.
  const access = await requireEventCapability(message.eventId, "event:edit");
  const admin = access.ok ? false : await isPlatformAdmin();
  if (!access.ok && !admin) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status }
    );
  }

  if (parsed.data.action === "hide" || parsed.data.action === "unhide") {
    const hiding = parsed.data.action === "hide";
    await db
      .update(eventMessages)
      .set({ status: hiding ? "hidden" : "visible", updatedAt: new Date() })
      .where(eq(eventMessages.id, messageId));

    // Acting on the message closes the reports against it. Leaving them open
    // means the queue fills with things already dealt with, and a queue
    // nobody trusts is a queue nobody reads.
    await db
      .update(messageReports)
      .set({ status: hiding ? "actioned" : "dismissed" })
      .where(
        and(
          eq(messageReports.messageId, messageId),
          eq(messageReports.status, "open")
        )
      );

    return NextResponse.json({ ok: true });
  }

  // block_author: bar them from this event's thread, and take down what they
  // already posted here. Blocking without clearing the backlog leaves the
  // organiser hiding messages one by one anyway.
  await db
    .insert(eventBans)
    .values({
      eventId: message.eventId,
      userId: message.authorId,
      createdBy: userId,
      reason: parsed.data.reason ?? null,
    })
    .onConflictDoNothing();

  await db
    .update(eventMessages)
    .set({ status: "hidden", updatedAt: new Date() })
    .where(
      and(
        eq(eventMessages.eventId, message.eventId),
        eq(eventMessages.authorId, message.authorId),
        eq(eventMessages.status, "visible")
      )
    );

  return NextResponse.json({ ok: true });
}
