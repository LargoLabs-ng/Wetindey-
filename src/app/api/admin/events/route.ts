import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isPlatformAdmin } from '@/lib/authz';
import { db } from '@/db';
import { events as eventsTable, orders, tickets } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    // Platform-admin only. Previously any signed-in organizer could read
    // every organization's revenue through these endpoints.
    if (!(await isPlatformAdmin())) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const allEvents = await db.query.events.findMany({
      with: { organization: true, ticketTypes: true },
    });

    const eventsWithMetrics = await Promise.all(
      allEvents.map(async (event) => {
        const eventOrders = await db.query.orders.findMany({
          where: eq(orders.eventId, event.id),
          with: { payments: true },
        });

        const paidOrders = eventOrders.filter((o) => o.payments?.some((p) => p.status === 'success'));
        const totalRevenue = paidOrders.reduce((sum, o) => {
          const totalNum = typeof o.total === 'string' ? parseFloat(o.total) : o.total;
          return sum + totalNum;
        }, 0);

        const attendees = await db.query.tickets.findMany({
          where: eq(tickets.eventId, event.id),
        });

        const checkedIn = attendees.filter((t) => t.status === 'checked_in').length;

        return {
          id: event.id,
          title: event.title,
          organizer: event.organization?.name || 'Unknown',
          organizerEmail: event.organization?.ownerId,
          status: event.status,
          startDatetime: event.startDatetime,
          endDatetime: event.endDatetime,
          venue: `${event.venueName}, ${event.city}`,
          metrics: { ticketsSold: attendees.length, checkedIn, totalRevenue, ticketTypes: event.ticketTypes.length },
        };
      })
    );

    return NextResponse.json({ events: eventsWithMetrics, total: eventsWithMetrics.length });
  } catch (error) {
    console.error('Error fetching events:', error);
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
  }
}
