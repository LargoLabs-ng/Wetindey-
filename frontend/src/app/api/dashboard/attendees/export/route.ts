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
import { answerColumns } from "@/lib/registration";

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
        orderId: tickets.orderId,
        orderCreatedAt: orders.createdAt,
      })
      .from(tickets)
      .leftJoin(ticketTypes, eq(tickets.ticketTypeId, ticketTypes.id))
      .leftJoin(orders, eq(tickets.orderId, orders.id))
      .where(eq(tickets.eventId, event.id));

    // One extra column per question the organiser asked. Answers live on the
    // ORDER, so every ticket bought together repeats them — which is what
    // somebody sorting this in Excel expects, since they are looking at a
    // row per person, not a row per receipt.
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

    const extraColumns = answerColumns(fieldRows, answerRows);

    const byOrder = new Map<string, Record<string, string>>();
    for (const a of answerRows) {
      const bag = byOrder.get(a.orderId) ?? {};
      bag[a.label] = a.value ?? "";
      byOrder.set(a.orderId, bag);
    }

    const header = [
      "Ticket ID",
      "Name",
      "Email",
      "Ticket type",
      "Status",
      "Purchased",
      "Checked in",
      ...extraColumns,
    ];

    const body = rows.map((row) => {
      const bag = byOrder.get(row.orderId) ?? {};
      return [
        row.id.slice(0, 8).toUpperCase(),
        row.name,
        row.email,
        row.ticketType ?? "",
        row.status,
        (row.orderCreatedAt ?? row.createdAt).toISOString(),
        row.checkedInAt ? row.checkedInAt.toISOString() : "",
        ...extraColumns.map((c) => bag[c] ?? ""),
      ]
        .map(csvCell)
        .join(",");
    });

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
