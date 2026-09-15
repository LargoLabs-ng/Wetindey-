import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { events } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getPrimaryOrganizationId, getSessionUserId } from '@/lib/authz';
import { generateUniqueSlug } from '@/lib/slug';

export async function GET(request: NextRequest) {
  try {
    const publishedEvents = await db.query.events.findMany({
      where: eq(events.status, 'published'),
      with: {
        ticketTypes: true,
      },
      orderBy: (events, { desc }) => desc(events.startDatetime),
    });

    return NextResponse.json(publishedEvents);
  } catch (error) {
    console.error('Error fetching events:', error);
    return NextResponse.json(
      { error: 'Failed to fetch events' },
      { status: 500 }
    );
  }
}

const createEventSchema = z.object({
  title: z.string().trim().min(3, 'Give your event a title of at least 3 characters.'),
  description: z.string().trim().optional(),
  category: z.string().trim().optional(),
  coverImage: z.string().url().nullish(),
  venueName: z.string().trim().optional(),
  city: z.string().trim().optional(),
  startDatetime: z.string().datetime('Pick a valid start date and time.'),
  endDatetime: z.string().datetime('Pick a valid end date and time.'),
});

/**
 * POST /api/events — create a draft event for the signed-in organizer.
 * Events start as drafts; POST /api/events/:id/publish takes them live.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const organizationId = await getPrimaryOrganizationId(userId);
    if (!organizationId) {
      return NextResponse.json(
        { error: 'No organization found for your account.' },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = createEventSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const start = new Date(data.startDatetime);
    const end = new Date(data.endDatetime);
    if (end <= start) {
      return NextResponse.json(
        { error: 'The end time has to be after the start time.' },
        { status: 400 }
      );
    }

    const slug = await generateUniqueSlug(data.title, async (candidate) => {
      const [existing] = await db
        .select({ id: events.id })
        .from(events)
        .where(eq(events.slug, candidate))
        .limit(1);
      return !!existing;
    });

    const [event] = await db
      .insert(events)
      .values({
        organizationId,
        title: data.title,
        coverImage: data.coverImage ?? null,
        slug,
        description: data.description || null,
        category: data.category || null,
        venueName: data.venueName || null,
        city: data.city || null,
        startDatetime: start,
        endDatetime: end,
      })
      .returning();

    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    console.error('Error creating event:', error);
    return NextResponse.json(
      { error: 'Failed to create event' },
      { status: 500 }
    );
  }
}
