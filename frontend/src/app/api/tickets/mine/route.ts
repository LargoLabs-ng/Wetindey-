import { NextResponse } from "next/server";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { getSessionUserId } from "@/lib/authz";
import { getBuyerAccount } from "@/lib/buyer-account";

/**
 * GET /api/tickets/mine — the signed-in person's own tickets.
 *
 * Two kinds of order are theirs:
 *
 * 1. Orders placed while signed in (orders.buyer_id). Since login became
 *    required to buy, that is every new order.
 * 2. Older guest orders (no buyer_id) placed with this account's email —
 *    but ONLY once the account has confirmed that email. An unconfirmed
 *    address proves nothing: anyone could sign up with someone else's email
 *    and read their QR codes. Google accounts count as confirmed.
 *
 * Matching is on the BUYER's email only, never on an attendee's: a friend
 * named on someone else's order does not get to see that order. Their
 * ticket reaches them through the buyer, as before.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await getBuyerAccount(userId);
  const ownEmail = account?.emailVerified ? account.email.trim().toLowerCase() : null;

  const mine = await db.query.orders.findMany({
    where: ownEmail
      ? or(
          eq(orders.buyerId, userId),
          and(isNull(orders.buyerId), sql`lower(trim(${orders.email})) = ${ownEmail}`)
        )
      : eq(orders.buyerId, userId),
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
    // Lets the page offer "confirm your email to see older guest tickets".
    emailVerified: Boolean(account?.emailVerified),
  });
}
