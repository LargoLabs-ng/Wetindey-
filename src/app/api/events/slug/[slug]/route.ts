import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { events } from '@/db/schema';
import { eq } from 'drizzle-orm';
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
        // The event page names who is running it — "published by the Faculty
        // of Law" is a large part of whether a student trusts a link.
        organization: true,
      },
    });

    if (!event) {
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

    return NextResponse.json(event);
  } catch (error) {
    console.error('Error fetching event:', error);
    return NextResponse.json(
      { error: 'Failed to fetch event' },
      { status: 500 }
    );
  }
}
