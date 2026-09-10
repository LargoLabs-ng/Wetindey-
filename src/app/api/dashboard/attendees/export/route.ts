import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tickets, ticketTypes, orders } from "@/db/schema";
import { requireEventCapability } from "@/lib/authz";

/** Wrap a value so commas, quotes and newlines can't break the CSV. */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * GET /api/dashboard/attendees/export?eventId=...
 * Downloads the guest list as CSV.
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

    const header = [
      "Ticket ID",
      "Name",
      "Email",
      "Ticket type",
      "Status",
      "Purchased",
      "Checked in",
    ];

    const body = rows.map((row) =>
      [
        row.id.slice(0, 8).toUpperCase(),
        row.name,
        row.email,
        row.ticketType ?? "",
        row.status,
        (row.orderCreatedAt ?? row.createdAt).toISOString(),
        row.checkedInAt ? row.checkedInAt.toISOString() : "",
      ]
        .map(csvCell)
        .join(",")
    );

    // BOM so Excel opens UTF-8 names correctly.
    const csv = "﻿" + [header.map(csvCell).join(","), ...body].join("\r\n");
    const filename = `${event.slug || "attendees"}-attendees.csv`;

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Error exporting attendees:", error);
    return NextResponse.json(
      { error: "Failed to export attendees" },
      { status: 500 }
    );
  }
}
