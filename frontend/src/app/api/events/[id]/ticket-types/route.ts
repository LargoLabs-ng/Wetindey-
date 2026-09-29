import { NextResponse } from "next/server";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { events, ticketTypes } from "@/db/schema";
import { getEventRole, getSessionUserId } from "@/lib/authz";
import { can } from "@/lib/permissions";

const createTicketTypeSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  price: z.coerce.number().min(0),
  quantityTotal: z.coerce.number().int().min(1),
  maxPerOrder: z.coerce.number().int().min(1).max(50).optional(),
  /**
   * How many people one ticket admits. 1 is an ordinary ticket.
   *
   * Capped at 50 for the same reason maxPerOrder is: a number in the
   * thousands here is a typo, and this one would silently multiply the
   * event's real capacity by it.
   */
  admits: z.coerce.number().int().min(1).max(50).optional(),
  // .nullable() matters: z.coerce.date() would turn an explicit null into
  // new Date(null) — the 1970 epoch — which then failed the ordering check
  // below even when the organizer left both fields blank.
  salesStart: z.coerce.date().nullable().optional(),
  salesEnd: z.coerce.date().nullable().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/events/:id/ticket-types — any org member can view.
export async function GET(_request: Request, context: RouteContext) {
  const { id: eventId } = await context.params;
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const role = await getEventRole(userId, event);
  if (!role || !can(role, "event:view")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const tiers = await db
    .select()
    .from(ticketTypes)
    .where(eq(ticketTypes.eventId, eventId))
    .orderBy(asc(ticketTypes.price));

  return NextResponse.json({ ticketTypes: tiers });
}

// POST /api/events/:id/ticket-types — Owner or Event Manager only.
export async function POST(request: Request, context: RouteContext) {
  const { id: eventId } = await context.params;
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const role = await getEventRole(userId, event);
  if (!role || !can(role, "tickets:manage")) {
    return NextResponse.json(
      { error: "You do not have permission to manage ticket types for this event." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = createTicketTypeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (
    parsed.data.salesStart &&
    parsed.data.salesEnd &&
    parsed.data.salesEnd <= parsed.data.salesStart
  ) {
    return NextResponse.json(
      { error: "Sales must end after they start." },
      { status: 400 }
    );
  }

  const [tier] = await db
    .insert(ticketTypes)
    .values({
      eventId,
      name: parsed.data.name,
      description: parsed.data.description,
      price: parsed.data.price.toFixed(2),
      quantityTotal: parsed.data.quantityTotal,
      maxPerOrder: parsed.data.maxPerOrder ?? 10,
      admits: parsed.data.admits ?? 1,
      salesStart: parsed.data.salesStart,
      salesEnd: parsed.data.salesEnd,
    })
    .returning();

  return NextResponse.json({ ticketType: tier }, { status: 201 });
}
