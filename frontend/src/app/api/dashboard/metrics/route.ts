import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { tickets, orders, ticketTypes } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireEventCapability } from '@/lib/authz';
import { analyzeEventSales } from '@/lib/event-analytics';
import { ticketSales } from '@/lib/event-revenue';
import { ticketTypeOrder } from '@/lib/ticket-type-order';

/**
 * GET /api/dashboard/metrics?eventId=xyz
 * Fetch metrics for a specific event
 */
export async function GET(request: NextRequest) {
  try {
    const access = await requireEventCapability(
      request.nextUrl.searchParams.get('eventId'),
      'event:view'
    );
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { event } = access;
    const eventId = event.id;

    // Fetch ticket types for this event
    const eventTicketTypes = await db.query.ticketTypes.findMany({
      where: eq(ticketTypes.eventId, eventId),
      orderBy: (t) => ticketTypeOrder(t),
    });

    // Fetch all tickets for this event
    const eventTickets = await db.query.tickets.findMany({
      where: eq(tickets.eventId, eventId),
    });

    // Calculate basic metrics
    const totalTickets = eventTicketTypes.reduce((sum, tt) => sum + tt.quantityTotal, 0);
    const soldTickets = eventTickets.filter((t) => t.status === 'valid' || t.status === 'checked_in').length;
    const checkedInTickets = eventTickets.filter((t) => t.status === 'checked_in').length;

    // Fetch orders to calculate revenue
    const eventOrders = await db.query.orders.findMany({
      where: and(eq(orders.eventId, eventId), eq(orders.status, 'paid')),
    });

    // Ticket sales after discounts, minus refunds, without the processing
    // fee buyers pay on top: the same figure as Finance's "Ticket sales".
    const sales = ticketSales(eventOrders, eventTickets);

    const analytics = analyzeEventSales({
      now: new Date(),
      eventStart: event.startDatetime,
      eventDateTbd: event.dateTbd,
      eventStatus: event.status,
      ticketsTotal: totalTickets,
      ticketsSold: soldTickets,
      orders: eventOrders.map((order) => ({
        id: order.id,
        createdAt: order.createdAt,
        subtotal: order.subtotal,
      })),
      tickets: eventTickets.map((ticket) => ({
        orderId: ticket.orderId,
        status: ticket.status,
      })),
    });

    // Build ticket breakdown by type
    const ticketBreakdown = eventTicketTypes.map((ticketType) => {
      const typeTickets = eventTickets.filter(
        (t) => t.ticketTypeId === ticketType.id && (t.status === 'valid' || t.status === 'checked_in')
      );

      return {
        tier: ticketType.name,
        sold: typeTickets.length,
        remaining: ticketType.quantityTotal - typeTickets.length,
        revenue: sales.byTicketType.get(ticketType.id) ?? 0,
      };
    });

    return NextResponse.json({
      ticketsSold: soldTickets,
      ticketsTotal: totalTickets,
      revenue: sales.total,
      checkedIn: checkedInTickets,
      eventTitle: event.title,
      ticketBreakdown,
      analytics,
    });
  } catch (error) {
    console.error('Error fetching metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch metrics' },
      { status: 500 }
    );
  }
}
