import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { events, ticketTypes } from "@/db/schema";
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
    // A venue that is openly "to be announced" clears this bar; a venue the
    // organiser simply left blank does not. That distinction is the point of
    // the flag — buyers of a TBA event know what they bought and are emailed
    // when it firms up, whereas a blank field tells them nothing and
    // promises them nothing.
    if (!event.venueName && !event.venueTbd) {
      missing.push("a venue (or the “not confirmed yet” switch)");
    }
    if (!event.city) missing.push("a city");

    // An event with no ticket types publishes a page with nothing on it —
    // a student arrives at a live event and finds no way in. The creation
    // flow now walks organizers through tiers before this point, so
    // reaching here without one means something went wrong.
    const [tier] = await db
      .select({ id: ticketTypes.id })
      .from(ticketTypes)
      .where(eq(ticketTypes.eventId, event.id))
      .limit(1);
    if (!tier) missing.push("at least one ticket type");

    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Cannot publish yet — this event still needs ${missing.join(", ")}.` },
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
