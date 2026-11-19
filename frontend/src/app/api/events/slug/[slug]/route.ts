import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { events, tickets, ticketTypes } from '@/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { publicGoingFloor } from '@/lib/going-badge';
import { toPublicTier } from '@/lib/public-tiers';
import { requireEventAccess } from '@/lib/authz';
import { can } from '@/lib/permissions';

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { slug } = await context.params;

    const event = await db.query.events.findFirst({
      where: eq(events.slug, slug),
      with: {
        ticketTypes: true,
      },
    });

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }
    if (event.archivedAt) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // This endpoint is public, so a draft must not be readable just because
    // someone guessed the slug. The organizer's own team still gets it, which
    // is what makes "preview before publishing" work.
    if (event.status !== 'published') {
      const access = await requireEventAccess(event.id);
      if (!access.ok || !can(access.role, 'event:view')) {
        return NextResponse.json({ error: 'Event not found' }, { status: 404 });
      }
    }

    // This endpoint hands the event row to the open internet, so anything
    // private comes off HERE rather than being merely absent from whichever
    // page happens to render it today.
    //
    // The after-purchase fields are why this matters. Their one promise is
    // that only somebody who paid ever sees them, and a WhatsApp invite
    // sitting in a JSON response anyone can curl breaks that promise while
    // the page above it still looks perfectly correct.
    //
    // Destructured rather than hand-picked into an allowlist, so adding an
    // ordinary column to `events` keeps working without a change here — but
    // a new PRIVATE column has to be added to this line.
    const { afterPurchaseNote, afterPurchaseUrl, ...publicEvent } = event;
    void afterPurchaseNote;
    void afterPurchaseUrl;

    // The public badge's floor, from confirmed tickets only (paid or checked
    // in; never pending, cancelled or refunded), counting people rather
    // than tickets — the same rule as /api/discover. Only the floor is
    // sent; the exact count stays on the server.
    const [attending] = await db
      .select({
        going: sql<number>`coalesce(sum(coalesce(${ticketTypes.admits}, 1)), 0)::int`,
      })
      .from(tickets)
      .leftJoin(ticketTypes, eq(tickets.ticketTypeId, ticketTypes.id))
      .where(
        and(
          eq(tickets.eventId, event.id),
          inArray(tickets.status, ['valid', 'checked_in'])
        )
      );

    const now = new Date();
    return NextResponse.json({
      ...publicEvent,
      goingFloor: publicGoingFloor(event.id, attending?.going ?? 0),
      // Keep `price` as the stored Regular price. The public page uses the
      // Early Bird fields and serverTime to calculate the active price and
      // switch it on an already-open page when the deadline arrives.
      // Tiers go out without stock numbers: a visitor learns "can I buy
      // this" and "sold out", never how many are left. See
      // lib/public-tiers.ts.
      ticketTypes: event.ticketTypes.map(toPublicTier),
      serverTime: now.toISOString(),
    });
  } catch (error) {
    console.error('Error fetching event:', error);
    return NextResponse.json(
      { error: 'Failed to fetch event' },
      { status: 500 }
    );
  }
}
