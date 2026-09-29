import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { requireEventCapability } from '@/lib/authz';
import { db } from '@/db';
import { tickets } from '@/db/schema';
import { and, eq, or, ilike, sql } from 'drizzle-orm';

/**
 * GET /api/check-in/search?eventId=xyz&query=...
 * Search for tickets by attendee name, email, phone, or ticket ID
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session || !session.user?.email) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const eventId = request.nextUrl.searchParams.get('eventId');
    const query = request.nextUrl.searchParams.get('query');

    if (!eventId || !query) {
      return NextResponse.json(
        { error: 'Missing eventId or query parameter' },
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

    // Search tickets by multiple fields
    // Support searching by: attendee name, email, ticket ID
    const searchResults = await db.query.tickets.findMany({
      where: and(
        eq(tickets.eventId, eventId),
        or(
          ilike(tickets.attendeeName, `%${query}%`),
          ilike(tickets.attendeeEmail, `%${query}%`),
          // id is a uuid: Postgres has no ILIKE for that type, so this
          // threw on every single search until it was cast to text.
          sql`${tickets.id}::text ILIKE ${`%${query.toLowerCase()}%`}`
        )
      ),
      limit: 10,
    });

    const results = searchResults.map((ticket) => ({
      id: ticket.id,
      attendeeName: ticket.attendeeName,
      attendeeEmail: ticket.attendeeEmail,
      ticketType: 'Standard',
      status: ticket.status,
    }));

    return NextResponse.json({ results });
  } catch (error) {
    console.error('Error searching tickets:', error);
    return NextResponse.json(
      { error: 'Search failed' },
      { status: 500 }
    );
  }
}
