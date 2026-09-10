import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { tickets, orders, ticketTypes } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireEventCapability } from '@/lib/authz';

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

    const totalRevenue = eventOrders.reduce((sum, order) => {
      const totalNum = typeof order.total === 'string' ? parseFloat(order.total) : order.total;
      return sum + totalNum;
    }, 0);

    // Build ticket breakdown by type
    const ticketBreakdown = eventTicketTypes.map((ticketType) => {
      const typeTickets = eventTickets.filter(
        (t) => t.ticketTypeId === ticketType.id && (t.status === 'valid' || t.status === 'checked_in')
      );

      const typeOrders = eventOrders.filter((o) =>
        eventTickets
          .filter((t) => t.orderId === o.id && t.ticketTypeId === ticketType.id)
          .some((t) => t.status === 'valid' || t.status === 'checked_in')
      );

      const typeRevenue = typeOrders.reduce((sum, order) => {
        const ticketCount = eventTickets.filter(
          (t) => t.orderId === order.id && t.ticketTypeId === ticketType.id
        ).length;
        const orderTotal = typeof order.total === 'string' ? parseFloat(order.total) : order.total;
        const totalTicketsInOrder = eventTickets.filter((t) => t.orderId === order.id).length || 1;
        return sum + (orderTotal / totalTicketsInOrder) * ticketCount;
      }, 0);

      return {
        tier: ticketType.name,
        sold: typeTickets.length,
        remaining: ticketType.quantityTotal - typeTickets.length,
        revenue: Math.round(typeRevenue),
      };
    });

    return NextResponse.json({
      ticketsSold: soldTickets,
      ticketsTotal: totalTickets,
      revenue: totalRevenue,
      checkedIn: checkedInTickets,
      eventTitle: event.title,
      ticketBreakdown,
    });
  } catch (error) {
    console.error('Error fetching metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch metrics' },
      { status: 500 }
    );
  }
}
