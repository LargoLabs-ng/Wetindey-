import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";
import { getEventRole, getSessionUserId } from "@/lib/authz";
import { can } from "@/lib/permissions";

const updateEventSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  category: z.string().max(100).optional(),
  coverImage: z.string().url().nullish(),
  venueName: z.string().max(200).optional(),
  venueAddress: z.string().optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  startDatetime: z.coerce.date().optional(),
  endDatetime: z.coerce.date().optional(),
  salesStart: z.coerce.date().optional(),
  salesEnd: z.coerce.date().optional(),
  feeStrategy: z.enum(["buyer_pays", "organizer_absorbs"]).optional(),
  platformFeePaidBy: z.enum(["organizer", "buyer"]).optional(),
});

async function loadEventAndMembership(eventId: string, userId: string) {
  const [event] = await db
    .select()
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  if (!event) return { event: null, membership: null };

  const role = await getEventRole(userId, event);
  return { event, membership: role ? { role } : null };
}

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/events/:id — any member of the owning organization can view.
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { event, membership } = await loadEventAndMembership(id, userId);
  if (!event || !membership) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ event });
}

// PATCH /api/events/:id — Owner or Event Manager only.
export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { event, membership } = await loadEventAndMembership(id, userId);
  if (!event) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!membership || !can(membership.role, "event:edit")) {
    return NextResponse.json(
      { error: "You do not have permission to edit this event." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = updateEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const nextStart = parsed.data.startDatetime ?? event.startDatetime;
  const nextEnd = parsed.data.endDatetime ?? event.endDatetime;
  if (nextEnd <= nextStart) {
    return NextResponse.json(
      { error: "endDatetime must be after startDatetime" },
      { status: 400 }
    );
  }

  // Publishing requires a venue and a city. Editing must not be a back door
  // that strips them off an event that is already live and selling.
  if (event.status === "published") {
    const nextVenue = parsed.data.venueName ?? event.venueName;
    const nextCity = parsed.data.city ?? event.city;
    if (!nextVenue?.trim() || !nextCity?.trim()) {
      return NextResponse.json(
        {
          error:
            "A published event needs a venue and a city. Unpublish it first if you need to clear them.",
        },
        { status: 400 }
      );
    }
  }

  const [updated] = await db
    .update(events)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(events.id, id))
    .returning();

  return NextResponse.json({ event: updated });
}

// DELETE /api/events/:id — Owner only (destroys attendee/order history).
export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { event, membership } = await loadEventAndMembership(id, userId);
  if (!event) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!membership || !can(membership.role, "event:delete")) {
    return NextResponse.json(
      { error: "Only the organization owner can delete events." },
      { status: 403 }
    );
  }

  await db.delete(events).where(eq(events.id, id));
  return NextResponse.json({ success: true });
}
