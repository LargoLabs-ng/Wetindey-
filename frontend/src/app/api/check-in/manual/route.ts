import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { requireEventCapability } from '@/lib/authz';
import { db } from '@/db';
import { tickets, checkIns } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * POST /api/check-in/manual
 * Manually check in an attendee by ticket ID
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

    const { ticketId, eventId } = await request.json();

    if (!ticketId || !eventId) {
      return NextResponse.json(
        { error: 'Missing ticketId or eventId' },
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

    // Find and verify ticket
    const ticket = await db.query.tickets.findFirst({
      where: and(eq(tickets.id, ticketId), eq(tickets.eventId, eventId)),
    });

    if (!ticket) {
      return NextResponse.json({
        status: 'invalid',
        message: 'Ticket not found.',
      });
    }

    // Check ticket status
    if (ticket.status === 'checked_in') {
      const checkIn = await db.query.checkIns.findFirst({
        where: eq(checkIns.ticketId, ticket.id),
        orderBy: (checkIns, { desc }) => [desc(checkIns.checkedInAt)],
      });

      return NextResponse.json({
        status: 'already_checked_in',
        message: `Already checked in at ${checkIn?.checkedInAt ? new Date(checkIn.checkedInAt).toLocaleTimeString() : 'unknown time'}`,
        attendeeName: ticket.attendeeName,
        ticketType: 'Standard',
      });
    }

    if (ticket.status !== 'valid') {
      return NextResponse.json({
        status: 'invalid',
        message: 'Ticket is no longer valid.',
        attendeeName: ticket.attendeeName,
      });
    }

    // Mark as checked in
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
      .where(and(eq(tickets.id, ticketId), eq(tickets.status, 'valid')))
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

    // Create check-in record.
    // checked_in_by is a uuid FK to users.id — this previously wrote
    // session.user.email into it, which Postgres rejected outright, so
    // every manual check-in failed with a 500.
    await db.insert(checkIns).values({
      id: crypto.randomUUID(),
      ticketId: ticket.id,
      eventId,
      checkedInAt: now,
      checkedInBy: access.userId,
      method: 'manual_lookup',
    });

    return NextResponse.json({
      status: 'valid',
      message: 'Attendee checked in successfully.',
      attendeeName: ticket.attendeeName,
      ticketType: 'Standard',
      checkedInAt: now.toISOString(),
    });
  } catch (error) {
    console.error('Error checking in attendee:', error);
    return NextResponse.json(
      {
        status: 'invalid',
        message: 'Error checking in attendee.',
      },
      { status: 500 }
    );
  }
}
