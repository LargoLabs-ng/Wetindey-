import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";
import { getEventRole, getSessionUserId } from "@/lib/authz";
import { can } from "@/lib/permissions";

const publishSchema = z.object({
  publish: z.boolean(),
});

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/events/:id/publish — { publish: true | false }
// Owner or Event Manager only. Publishing is the moment an event becomes
// visible on its public page and shareable — worth a real gate, not just
// a status flip.
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [event] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  if (!event) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const role = await getEventRole(userId, event);
  if (!role || !can(role, "event:edit")) {
    return NextResponse.json(
      { error: "You do not have permission to publish this event." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = publishSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  if (event.status === "cancelled") {
    return NextResponse.json(
      { error: "A cancelled event cannot be published." },
      { status: 409 }
    );
  }

  if (parsed.data.publish) {
    // Minimum bar to go live: attendees need to know where and when.
    // (Ticket types are intentionally not required here — an organizer
    // may publish event details first and add tickets moments later.)
    const missing: string[] = [];
    if (!event.venueName) missing.push("venueName");
    if (!event.city) missing.push("city");
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Cannot publish — missing required fields: ${missing.join(", ")}` },
        { status: 400 }
      );
    }
  }

  const [updated] = await db
    .update(events)
    .set({
      status: parsed.data.publish ? "published" : "unpublished",
      updatedAt: new Date(),
    })
    .where(eq(events.id, id))
    .returning();

  return NextResponse.json({ event: updated });
}
