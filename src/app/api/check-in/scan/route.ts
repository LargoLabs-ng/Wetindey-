import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { requireEventCapability } from '@/lib/authz';
import { db } from '@/db';
import { tickets, checkIns } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * POST /api/check-in/scan
 * Verify and check in a ticket via QR code
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session || !session.user?.email) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { token, eventId } = await request.json();

    if (!token || !eventId) {
      return NextResponse.json(
        {
          status: 'invalid',
          message: 'Invalid QR code data',
        },
        { status: 400 }
      );
    }

    // Gate: the caller must belong to the organization that owns this event.
    // Without this, any signed-in account could check in another
    // organizer's attendees.
    const access = await requireEventCapability(eventId, 'checkin:perform');
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    // Find ticket by QR token
    const ticket = await db.query.tickets.findFirst({
      where: and(eq(tickets.qrToken, token), eq(tickets.eventId, eventId)),
      with: {
        order: true,
      },
    });

    if (!ticket) {
      return NextResponse.json({
        status: 'invalid',
        message: 'Ticket not found. Invalid or expired QR code.',
      });
    }

    // Check ticket status
    if (ticket.status === 'checked_in') {
      // Already checked in - return warning
      const checkIn = await db.query.checkIns.findFirst({
        where: eq(checkIns.ticketId, ticket.id),
        orderBy: (checkIns, { desc }) => [desc(checkIns.checkedInAt)],
      });

      return NextResponse.json({
        status: 'already_checked_in',
        message: `Already checked in at ${checkIn?.checkedInAt ? new Date(checkIn.checkedInAt).toLocaleTimeString() : 'unknown time'}`,
        attendeeName: ticket.attendeeName,
        ticketType: 'Standard',
        checkedInAt: checkIn?.checkedInAt,
      });
    }

    if (ticket.status !== 'valid') {
      return NextResponse.json({
        status: 'invalid',
        message: 'Ticket is no longer valid. Status: ' + ticket.status,
        attendeeName: ticket.attendeeName,
      });
    }

    // Mark ticket as checked in
    const now = new Date();

    await db
      .update(tickets)
      .set({
        status: 'checked_in',
        checkedInAt: now,
        checkedInBy: access.userId,
      })
      .where(eq(tickets.id, ticket.id));

    // Create check-in record
    await db.insert(checkIns).values({
      id: crypto.randomUUID(),
      ticketId: ticket.id,
      eventId,
      checkedInAt: now,
      checkedInBy: access.userId,
      method: 'qr_scan',
    });

    return NextResponse.json({
      status: 'valid',
      message: 'Ticket verified. Admit attendee.',
      attendeeName: ticket.attendeeName,
      ticketType: 'Standard',
      checkedInAt: now.toISOString(),
    });
  } catch (error) {
    console.error('Error scanning ticket:', error);
    return NextResponse.json(
      {
        status: 'invalid',
        message: 'Error verifying ticket. Please try again.',
      },
      { status: 500 }
    );
  }
}
