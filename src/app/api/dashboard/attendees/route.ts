import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  registrationAnswers,
  registrationFields,
  tickets,
  ticketTypes,
  orders,
} from "@/db/schema";
import { requireEventCapability } from "@/lib/authz";
import { can } from "@/lib/permissions";
import { answerColumns } from "@/lib/registration";

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
        orderId: tickets.orderId,
        orderCreatedAt: orders.createdAt,
      })
      .from(tickets)
      .leftJoin(ticketTypes, eq(tickets.ticketTypeId, ticketTypes.id))
      .leftJoin(orders, eq(tickets.orderId, orders.id))
      .where(eq(tickets.eventId, event.id));

    // The organiser's extra questions are answered once per ORDER, so three
    // tickets bought together carry the same answers. Fetched in one query
    // and attached in memory rather than joined — a join here multiplies
    // ticket rows by answer rows, and the guest list would list everybody
    // once per question.
    const [answerRows, fieldRows] = await Promise.all([
      db
        .select({
          orderId: registrationAnswers.orderId,
          label: registrationAnswers.label,
          value: registrationAnswers.value,
        })
        .from(registrationAnswers)
        .where(eq(registrationAnswers.eventId, event.id)),
      db
        .select({
          label: registrationFields.label,
          position: registrationFields.position,
        })
        .from(registrationFields)
        .where(eq(registrationFields.eventId, event.id))
        .orderBy(asc(registrationFields.position)),
    ]);

    const byOrder = new Map<string, { label: string; value: string }[]>();
    for (const a of answerRows) {
      const list = byOrder.get(a.orderId) ?? [];
      list.push({ label: a.label, value: a.value ?? "" });
      byOrder.set(a.orderId, list);
    }

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
        answers: byOrder.get(row.orderId) ?? [],
      }))
      .sort((a, b) => b.purchaseTime.localeCompare(a.purchaseTime));

    return NextResponse.json({
      eventTitle: event.title,
      attendees,
      // Column order for whoever renders this: current questions first, then
      // any label that only survives in old answers.
      answerColumns: answerColumns(fieldRows, answerRows),
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
