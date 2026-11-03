import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  events,
  orders,
  organizations,
  refunds,
  ticketTypes,
  tickets,
  users,
} from "@/db/schema";
import { isPlatformAdmin, isUuid } from "@/lib/authz";

const archiveSchema = z.object({
  action: z.enum(["archive", "restore"]),
});

type RouteContext = { params: Promise<{ eventId: string }> };

async function findEvent(eventId: string) {
  if (!isUuid(eventId)) return null;
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  return event ?? null;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    if (!(await isPlatformAdmin())) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { eventId } = await context.params;
    const event = await findEvent(eventId);
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const [organization] = await db
      .select({
        name: organizations.name,
        ownerId: organizations.ownerId,
      })
      .from(organizations)
      .where(eq(organizations.id, event.organizationId))
      .limit(1);
    const [owner] = organization
      ? await db
          .select({ name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, organization.ownerId))
          .limit(1)
      : [];

    const [ticketRows, paidOrders, refundRows, tierRows] = await Promise.all([
      db
        .select({
          ticketTypeId: tickets.ticketTypeId,
          status: tickets.status,
        })
        .from(tickets)
        .where(eq(tickets.eventId, event.id)),
      db
        .select({
          id: orders.id,
          total: orders.total,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .where(and(eq(orders.eventId, event.id), eq(orders.status, "paid"))),
      db
        .select({
          amount: refunds.amount,
          status: refunds.status,
        })
        .from(refunds)
        .where(eq(refunds.eventId, event.id)),
      db
        .select({
          id: ticketTypes.id,
          name: ticketTypes.name,
          price: ticketTypes.price,
          status: ticketTypes.status,
          quantityTotal: ticketTypes.quantityTotal,
          quantitySold: ticketTypes.quantitySold,
        })
        .from(ticketTypes)
        .where(eq(ticketTypes.eventId, event.id)),
    ]);

    const paidTickets = ticketRows.filter(
      (ticket) => ticket.status === "valid" || ticket.status === "checked_in"
    );
    const ticketsByType = new Map<string, number>();
    for (const ticket of paidTickets) {
      ticketsByType.set(
        ticket.ticketTypeId,
        (ticketsByType.get(ticket.ticketTypeId) ?? 0) + 1
      );
    }

    const monthlySales = new Map<string, { orders: number; revenue: number }>();
    for (const order of paidOrders) {
      const month = order.createdAt.toISOString().slice(0, 7);
      const row = monthlySales.get(month) ?? { orders: 0, revenue: 0 };
      row.orders += 1;
      row.revenue += Number(order.total);
      monthlySales.set(month, row);
    }

    const completedRefunds = refundRows.filter((refund) => refund.status === "completed");
    const totalRefunded = completedRefunds.reduce(
      (sum, refund) => sum + Number(refund.amount),
      0
    );

    return NextResponse.json({
      event: {
        id: event.id,
        title: event.title,
        slug: event.slug,
        status: event.status,
        archivedAt: event.archivedAt?.toISOString() ?? null,
        startDatetime: event.startDatetime.toISOString(),
        endDatetime: event.endDatetime.toISOString(),
        venue: [event.venueName, event.city].filter(Boolean).join(", "),
        organizer: organization?.name ?? "Unknown",
        organizerName: owner?.name ?? null,
        organizerEmail: owner?.email ?? null,
      },
      metrics: {
        ticketsSold: paidTickets.length,
        checkedIn: ticketRows.filter((ticket) => ticket.status === "checked_in").length,
        paidOrders: paidOrders.length,
        totalRevenue: paidOrders.reduce((sum, order) => sum + Number(order.total), 0),
        totalRefunded,
        ticketTypes: tierRows.length,
      },
      ticketTypes: tierRows.map((ticketType) => ({
        ...ticketType,
        ticketsSold: ticketsByType.get(ticketType.id) ?? 0,
      })),
      monthlySales: [...monthlySales.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, values]) => ({ month, ...values })),
    });
  } catch (error) {
    console.error("Error fetching admin event analytics:", error);
    return NextResponse.json(
      { error: "Failed to fetch event analytics" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    if (!(await isPlatformAdmin())) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { eventId } = await context.params;
    const event = await findEvent(eventId);
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const parsed = archiveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid archive action" }, { status: 400 });
    }

    const archived = parsed.data.action === "archive";
    if (!archived && !event.archivedAt) {
      return NextResponse.json(
        { error: "This event is not archived." },
        { status: 409 }
      );
    }

    const [updated] = await db
      .update(events)
      .set({
        archivedAt: archived ? event.archivedAt ?? new Date() : null,
        status: "unpublished",
        updatedAt: new Date(),
      })
      .where(eq(events.id, event.id))
      .returning({
        id: events.id,
        status: events.status,
        archivedAt: events.archivedAt,
      });

    return NextResponse.json({
      event: {
        ...updated,
        archivedAt: updated.archivedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    console.error("Error archiving admin event:", error);
    return NextResponse.json(
      { error: "Failed to update event archive status" },
      { status: 500 }
    );
  }
}
