import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cancelEvent, cancellationBill } from "@/lib/cancel-event";
import { requireEventCapability } from "@/lib/authz";

type RouteContext = { params: Promise<{ id: string }> };

const schema = z.object({
  reason: z.string().trim().max(500).optional(),
  /**
   * Nothing happens without this. A GET-shaped preview would have been
   * tidier, but cancelling is the kind of action that gets wired to a button
   * and then fired by a stray click — making the destructive path require an
   * extra field means it cannot be reached by accident.
   */
  confirm: z.literal(true).optional(),
});

/**
 * POST /api/events/:id/cancel
 *
 * Without `confirm: true`, returns what cancelling would cost and changes
 * nothing. With it, voids every ticket and emails every buyer.
 *
 * No money moves here either way. Refunds are a separate, explicitly
 * confirmed call — see /api/events/:id/refund-all. Telling people early
 * matters more than paying them back fast; paying them back is the part you
 * want a human to have read a total before triggering.
 *
 * Gated on `event:delete` rather than `event:edit`. Calling off an event is
 * closer to deleting it than to renaming it, and the staff who may reschedule
 * an event are not necessarily the staff who may call it off.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const access = await requireEventCapability(id, "event:delete");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (access.event.status === "cancelled") {
    return NextResponse.json(
      { error: "This event is already cancelled." },
      { status: 409 }
    );
  }

  if (!parsed.data.confirm) {
    return NextResponse.json({
      preview: true,
      event: { id: access.event.id, title: access.event.title },
      bill: await cancellationBill(id),
    });
  }

  const result = await cancelEvent(id, parsed.data.reason ?? null);

  return NextResponse.json({
    cancelled: true,
    ...result,
    // Deliberately explicit, because the difference matters and an organiser
    // reading a success message will assume the money has gone otherwise.
    refundsIssued: false,
    next: result.bill.orders > 0 ? `/api/events/${id}/refund-all` : null,
  });
}
