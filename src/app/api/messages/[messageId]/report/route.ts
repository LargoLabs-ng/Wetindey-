import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { eventMessages, messageReports } from "@/db/schema";
import { getSessionUserId, isUuid } from "@/lib/authz";

type RouteContext = { params: Promise<{ messageId: string }> };

const schema = z.object({
  reason: z.enum(["spam", "abuse", "scam", "off_topic", "other"]),
  note: z.string().trim().max(300).optional(),
});

/**
 * POST /api/messages/:messageId/report
 *
 * Reporting requires an account. An anonymous report button is a button for
 * flooding the queue, and there is nobody to come back to for detail.
 *
 * The response is the same whether this is a first report or a repeat, and
 * it never says how many other people have reported the same message.
 * Telling someone their report was "the third" turns reporting into a
 * scoreboard and tells a bad actor exactly how close they are to a
 * threshold.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { messageId } = await context.params;
  if (!isUuid(messageId)) {
    return NextResponse.json({ error: "Unknown message." }, { status: 400 });
  }

  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { error: "Sign in to report a message." },
      { status: 401 }
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Pick a reason." }, { status: 400 });
  }

  const message = await db.query.eventMessages.findFirst({
    where: eq(eventMessages.id, messageId),
  });
  if (!message) {
    return NextResponse.json({ error: "Unknown message." }, { status: 404 });
  }

  // onConflictDoNothing against the unique index on (message, reporter):
  // reporting twice is a no-op rather than an error, so the UI never has to
  // explain a failure that doesn't matter.
  await db
    .insert(messageReports)
    .values({
      messageId,
      reporterId: userId,
      reason: parsed.data.reason,
      note: parsed.data.note ?? null,
    })
    .onConflictDoNothing();

  return NextResponse.json({
    ok: true,
    message: "Thanks — the organiser will take a look.",
  });
}
