import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { events, ticketTypes } from "@/db/schema";
import { getEventRole, getSessionUserId } from "@/lib/authz";
import { can } from "@/lib/permissions";
import {
  datetimeLocalToUtc,
  isValidEarlyBirdConfiguration,
} from "@/lib/early-bird";

const updateTicketTypeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  price: z.coerce.number().min(0).optional(),
  quantityTotal: z.coerce.number().int().min(1).optional(),
  maxPerOrder: z.coerce.number().int().min(1).max(50).optional(),
  admits: z.coerce.number().int().min(1).max(50).optional(),
  status: z.enum(["active", "paused", "sold_out"]).optional(),
  // Nullable so a sales window set at creation can also be cleared.
  salesStart: z.coerce.date().nullable().optional(),
  salesEnd: z.coerce.date().nullable().optional(),
  earlyBirdEnabled: z.boolean().optional(),
  earlyBirdPrice: z.coerce.number().min(0).nullable().optional(),
  earlyBirdEndsAtLocal: z.string().nullable().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

async function loadTierWithMembership(tierId: string, userId: string) {
  const [tier] = await db
    .select()
    .from(ticketTypes)
    .where(eq(ticketTypes.id, tierId))
    .limit(1);
  if (!tier) return { tier: null, membership: null, event: null };

  const [event] = await db.select().from(events).where(eq(events.id, tier.eventId)).limit(1);
  if (!event) return { tier: null, membership: null, event: null };

  const role = await getEventRole(userId, event);
  return { tier, membership: role ? { role } : null, event };
}

// PATCH /api/ticket-types/:id — Owner or Event Manager only.
export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tier, membership, event } = await loadTierWithMembership(id, userId);
  if (!tier) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!membership || !can(membership.role, "tickets:manage")) {
    return NextResponse.json(
      { error: "You do not have permission to edit this ticket type." },
      { status: 403 }
    );
  }
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = updateTicketTypeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const earlyBirdEnabled =
    parsed.data.earlyBirdEnabled ?? tier.earlyBirdEnabled;
  const regularPrice = parsed.data.price ?? Number(tier.price);
  const earlyBirdPrice =
    parsed.data.earlyBirdPrice !== undefined
      ? parsed.data.earlyBirdPrice
      : tier.earlyBirdPrice === null
        ? null
        : Number(tier.earlyBirdPrice);
  const earlyBirdEndsAt =
    parsed.data.earlyBirdEndsAtLocal !== undefined
      ? parsed.data.earlyBirdEndsAtLocal
        ? datetimeLocalToUtc(parsed.data.earlyBirdEndsAtLocal, event.timeZone)
        : null
      : tier.earlyBirdEndsAt;
  if (
    earlyBirdEnabled &&
    !isValidEarlyBirdConfiguration(
      regularPrice,
      earlyBirdPrice,
      earlyBirdEndsAt
    )
  ) {
    return NextResponse.json(
      { error: "Early Bird needs a valid deadline and a price lower than the Regular price." },
      { status: 400 }
    );
  }

  // Never allow shrinking capacity below what's already sold — protects
  // against overselling if an organizer reduces quantity after sales start.
  if (
    parsed.data.quantityTotal !== undefined &&
    parsed.data.quantityTotal < tier.quantitySold
  ) {
    return NextResponse.json(
      {
        error: `Cannot set quantity below ${tier.quantitySold} — that many tickets are already sold.`,
      },
      { status: 400 }
    );
  }

  /**
   * How many people a ticket admits is part of what somebody BOUGHT.
   *
   * An organiser who sells twenty tables of six and then edits this to two
   * has quietly taken eighty seats off people who already paid — and nothing
   * in the system would tell them, because the ticket looks unchanged. So
   * once one has sold, this number is fixed: make a new tier instead.
   *
   * Sending the same value back is fine, since the edit form posts every
   * field whether or not it was touched.
   */
  if (
    parsed.data.admits !== undefined &&
    parsed.data.admits !== tier.admits &&
    tier.quantitySold > 0
  ) {
    return NextResponse.json(
      {
        error: `${tier.quantitySold} of these have already sold, admitting ${tier.admits} ${
          tier.admits === 1 ? "person" : "people"
        } each. Changing that now would shortchange people who already paid — add a separate tier instead.`,
      },
      { status: 409 }
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

  const fields = {
    name: parsed.data.name,
    description: parsed.data.description,
    price: parsed.data.price,
    quantityTotal: parsed.data.quantityTotal,
    maxPerOrder: parsed.data.maxPerOrder,
    admits: parsed.data.admits,
    status: parsed.data.status,
    salesStart: parsed.data.salesStart,
    salesEnd: parsed.data.salesEnd,
  };
  const [updated] = await db
    .update(ticketTypes)
    .set({
      ...fields,
      price: parsed.data.price !== undefined ? parsed.data.price.toFixed(2) : undefined,
      earlyBirdEnabled,
      earlyBirdPrice: earlyBirdEnabled ? earlyBirdPrice!.toFixed(2) : null,
      earlyBirdEndsAt: earlyBirdEnabled ? earlyBirdEndsAt : null,
    })
    .where(eq(ticketTypes.id, id))
    .returning();

  return NextResponse.json({ ticketType: updated });
}

// DELETE /api/ticket-types/:id — Owner or Event Manager only. Blocked once
// any tickets have sold, to avoid orphaning paid orders.
export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tier, membership } = await loadTierWithMembership(id, userId);
  if (!tier) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!membership || !can(membership.role, "tickets:manage")) {
    return NextResponse.json(
      { error: "You do not have permission to delete this ticket type." },
      { status: 403 }
    );
  }

  if (tier.quantitySold > 0) {
    return NextResponse.json(
      { error: "Cannot delete a ticket type that already has sales. Pause it instead." },
      { status: 409 }
    );
  }

  await db.delete(ticketTypes).where(eq(ticketTypes.id, id));
  return NextResponse.json({ success: true });
}
