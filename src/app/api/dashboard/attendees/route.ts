import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tickets, ticketTypes, orders } from "@/db/schema";
import { requireEventCapability } from "@/lib/authz";
import { can } from "@/lib/permissions";

/**
 * GET /api/dashboard/attendees?eventId=...
 * The guest list for one event. qrToken is deliberately never returned —
 * it is the scannable secret and belongs only on the buyer's ticket.
 */
export async function GET(request: NextRequest) {
  try {
    const access = await requireEventCapability(
      request.nextUrl.searchParams.get("eventId"),
      'attendees:view'
    );
    if (!access.ok) {
      return NextResponse.json(
        { error: access.error },
        { status: access.status }
      );
    }
    const { event } = access;

    const rows = await db
      .select({
        id: tickets.id,
        name: tickets.attendeeName,
        email: tickets.attendeeEmail,
        status: tickets.status,
        checkedInAt: tickets.checkedInAt,
        createdAt: tickets.createdAt,
        ticketType: ticketTypes.name,
        orderCreatedAt: orders.createdAt,
      })
      .from(tickets)
      .leftJoin(ticketTypes, eq(tickets.ticketTypeId, ticketTypes.id))
      .leftJoin(orders, eq(tickets.orderId, orders.id))
      .where(eq(tickets.eventId, event.id));

    const attendees = rows
      .map((row) => ({
        id: row.id,
        ticketId: row.id.slice(0, 8).toUpperCase(),
        name: row.name,
        email: row.email,
        ticketType: row.ticketType ?? "—",
        status: row.status,
        purchaseTime: (row.orderCreatedAt ?? row.createdAt).toISOString(),
        checkedInAt: row.checkedInAt ? row.checkedInAt.toISOString() : undefined,
      }))
      .sort((a, b) => b.purchaseTime.localeCompare(a.purchaseTime));

    return NextResponse.json({
      eventTitle: event.title,
      attendees,
      canRefund: can(access.role, "refund:issue"),
    });
  } catch (error) {
    console.error("Error fetching attendees:", error);
    return NextResponse.json(
      { error: "Failed to fetch attendees" },
      { status: 500 }
    );
  }
}
