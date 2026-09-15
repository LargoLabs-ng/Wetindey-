import { NextRequest, NextResponse } from 'next/server';
import { PLATFORM_FEE_RATE } from '@/lib/fees';
import { auth } from '@/auth';
import { isPlatformAdmin } from '@/lib/authz';
import { db } from '@/db';
import { events, orders, tickets } from '@/db/schema';
import { eq } from 'drizzle-orm';

/**
 * GET /api/admin/export?format=csv|pdf&type=events|financials
 * Export admin data in CSV or PDF format
 */
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

    const format = request.nextUrl.searchParams.get('format') || 'csv'; // csv or pdf
    const type = request.nextUrl.searchParams.get('type') || 'events'; // events, financials, attendees

    if (format === 'csv') {
      let csv = '';

      if (type === 'events') {
        // Export all events with metrics
        const allEvents = await db.query.events.findMany({
          with: { organization: true },
        });

        csv =
          'Event ID,Title,Organizer,Email,Status,Start Date,Venue,City,Tickets Sold,Revenue\n';

        for (const event of allEvents) {
          const eventOrders = await db.query.orders.findMany({
            where: eq(orders.eventId, event.id),
            with: { payments: true },
          });

          const revenue = eventOrders
            .filter((o) => o.payments?.some((p) => p.status === 'success'))
            .reduce((sum, o) => {
              const totalNum = typeof o.total === 'string' ? parseFloat(o.total) : o.total;
              return sum + totalNum;
            }, 0);

          const attendees = await db.query.tickets.findMany({
            where: eq(tickets.eventId, event.id),
          });

          csv += `"${event.id}","${event.title}","${event.organization?.name || 'N/A'}","${event.organization?.ownerId || 'N/A'}","${event.status}","${event.startDatetime}","${event.venueName}","${event.city}",${attendees.length},${revenue}\n`;
        }
      } else if (type === 'financials') {
        // Export financial data
        const allOrders = await db.query.orders.findMany({
          with: { event: true, payments: true },
        });

        csv =
          `Order ID,Event,Amount,Fee (${PLATFORM_FEE_RATE * 100}%),Net Revenue,Status,Date,Organizer\n`;

        for (const order of allOrders) {
          const successPayment = order.payments?.find((p) => p.status === 'success');
          if (successPayment) {
            const totalNum = typeof order.total === 'string' ? parseFloat(order.total) : order.total;
            const fee = totalNum * PLATFORM_FEE_RATE;
            const net = totalNum - fee;
            csv += `"${order.id}","${order.event?.title || 'N/A'}",${totalNum},${fee},${net},"${successPayment.status}","${order.createdAt}","${order.event?.organizationId || 'N/A'}"\n`;
          }
        }
      } else if (type === 'attendees') {
        // Export all attendees
        csv =
          'Ticket ID,Event,Attendee Name,Email,Status,Ticket Type,Checked In,Purchase Date\n';

        const allTickets = await db.query.tickets.findMany({
          with: { event: true },
        });

        for (const ticket of allTickets) {
          csv += `"${ticket.id}","${ticket.event?.title || 'N/A'}","${ticket.attendeeName}","${ticket.attendeeEmail}","${ticket.status}","Standard","${ticket.checkedInAt || 'No'}","${ticket.createdAt}"\n`;
        }
      }

      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${type}-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      });
    } else if (format === 'pdf') {
      // For PDF, return JSON that frontend can use to generate PDF
      const allEvents = await db.query.events.findMany({
        with: { organization: true },
      });

      const reportData = {
        title: `Wetin Dey Admin Report - ${type}`,
        generatedAt: new Date().toLocaleString(),
        data: allEvents.map((e) => ({
          event: e.title,
          organizer: e.organization?.name,
          status: e.status,
        })),
      };

      return NextResponse.json(reportData);
    }

    return NextResponse.json(
      { error: 'Invalid format or type' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Error exporting data:', error);
    return NextResponse.json({ error: 'Failed to export data' }, { status: 500 });
  }
}
