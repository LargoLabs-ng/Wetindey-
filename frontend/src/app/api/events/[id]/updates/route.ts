import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { eventUpdates } from "@/db/schema";
import { requireEventCapability } from "@/lib/authz";

type RouteContext = { params: Promise<{ id: string }> };

const schema = z.object({ body: z.string().trim().min(1).max(1000) });

/**
 * POST /api/events/:id/updates — an organiser announcement.
 *
 * Gated on `event:edit` rather than a capability of its own. An update is
 * the organiser speaking as the event — "doors open by 7", "the venue don
 * change" — so whoever may change the event's details is exactly who may
 * say so. A gate volunteer who can scan tickets cannot announce anything.
 *
 * Reads come back from the conversation endpoint alongside the messages, so
 * the event page fetches the whole thread in one request.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const access = await requireEventCapability(id, "event:edit");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "An update needs between 1 and 1000 characters." },
      { status: 400 }
    );
  }

  const [created] = await db
    .insert(eventUpdates)
    .values({ eventId: id, authorId: access.userId, body: parsed.data.body })
    .returning();

  return NextResponse.json({ id: created.id }, { status: 201 });
}
