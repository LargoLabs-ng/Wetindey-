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
        // Needed for `admits`. One scan on a table ticket has to tell the
        // person on the door how many people to let through, and the tier is
        // the only place that number lives.
        ticketType: true,
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
        ticketType: ticket.ticketType?.name ?? 'Standard',
        admits: ticket.ticketType?.admits ?? 1,
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

    // Claim the ticket with the write itself rather than trusting the read
    // above. Two phones scanning the same QR in the same second both saw
    // 'valid' and both admitted the holder; Postgres locks the row for an
    // UPDATE, so only one of them can match `status = 'valid'` and the loser
    // gets zero rows back.
    const claimed = await db
      .update(tickets)
      .set({
        status: 'checked_in',
        checkedInAt: now,
        checkedInBy: access.userId,
      })
      .where(and(eq(tickets.id, ticket.id), eq(tickets.status, 'valid')))
      .returning({ id: tickets.id });

    if (claimed.length === 0) {
      const existing = await db.query.checkIns.findFirst({
        where: eq(checkIns.ticketId, ticket.id),
        orderBy: (checkIns, { desc }) => [desc(checkIns.checkedInAt)],
      });
      return NextResponse.json({
        status: 'already_checked_in',
        message: existing?.checkedInAt
          ? `Already checked in at ${new Date(existing.checkedInAt).toLocaleTimeString()}`
          : 'Already checked in a moment ago',
        attendeeName: ticket.attendeeName,
        checkedInAt: existing?.checkedInAt,
      });
    }

    // Create check-in record
    await db.insert(checkIns).values({
      id: crypto.randomUUID(),
      ticketId: ticket.id,
      eventId,
      checkedInAt: now,
      checkedInBy: access.userId,
      method: 'qr_scan',
    });

    // The number the person on the door actually needs. A table ticket that
    // says "admit attendee" gets one person through and leaves five arguing
    // in the queue, so the count leads the message.
    const admits = ticket.ticketType?.admits ?? 1;

    return NextResponse.json({
      status: 'valid',
      message:
        admits > 1
          ? `Ticket verified. Admit ${admits} people.`
          : 'Ticket verified. Admit attendee.',
      attendeeName: ticket.attendeeName,
      ticketType: ticket.ticketType?.name ?? 'Standard',
      admits,
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
