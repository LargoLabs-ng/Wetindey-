import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { getSessionUserId } from "@/lib/authz";

/**
 * GET /api/tickets/mine — the signed-in student's own tickets.
 *
 * Matched on orders.buyer_id only, never on email. An account's email is not
 * verified at signup, so matching on it would mean anyone could register with
 * your address and read your tickets. Guest purchases are reached through the
 * recovery flow instead, which proves control of the inbox by sending to it.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const mine = await db.query.orders.findMany({
    where: eq(orders.buyerId, userId),
    orderBy: [desc(orders.createdAt)],
    with: { event: true, tickets: { with: { ticketType: true } } },
  });

  const paid = mine.filter((o) => o.status === "paid");

  const items = paid.flatMap((o) =>
    o.tickets
      .filter((t) => t.status === "valid" || t.status === "checked_in")
      .map((t) => ({
        ticketId: t.id,
        qrToken: t.qrToken,
        status: t.status,
        attendeeName: t.attendeeName,
        attendeeEmail: t.attendeeEmail,
        tierName: t.ticketType?.name ?? "Ticket",
        checkedInAt: t.checkedInAt ? new Date(t.checkedInAt).toISOString() : null,
        event: {
          id: o.event.id,
          slug: o.event.slug,
          title: o.event.title,
          coverImage: o.event.coverImage,
          venueName: o.event.venueName,
          city: o.event.city,
          startDatetime: new Date(o.event.startDatetime).toISOString(),
          endDatetime: new Date(o.event.endDatetime).toISOString(),
          // Safe to include: `paid` above already narrowed this list to
          // orders that went through. The rule for this field is that it
          // never reaches anyone who hasn't paid, and that filter is what
          // enforces it here.
          afterPurchase:
            o.event.afterPurchaseNote || o.event.afterPurchaseUrl
              ? {
                  note: o.event.afterPurchaseNote,
                  url: o.event.afterPurchaseUrl,
                }
              : null,
        },
      }))
  );

  const now = Date.now();
  return NextResponse.json({
    upcoming: items.filter((i) => new Date(i.event.endDatetime).getTime() >= now),
    past: items.filter((i) => new Date(i.event.endDatetime).getTime() < now),
  });
}
