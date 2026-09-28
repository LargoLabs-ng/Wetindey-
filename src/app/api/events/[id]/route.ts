import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";
import { getEventRole, getSessionUserId } from "@/lib/authz";
import { can } from "@/lib/permissions";
import { MAX_GALLERY, MAX_SPONSORS, isSafeHttpUrl } from "@/lib/media";
import { describeChanges, notifyDetailsChanged } from "@/lib/notify-change";

/**
 * An optional field whose blank is a deletion.
 *
 * A form posts "" for a box somebody emptied. Storing that as an empty
 * string means every reader downstream has to test for two kinds of nothing,
 * and one of them eventually gets forgotten and renders an empty box on
 * somebody's ticket.
 */
const optionalNote = z
  .string()
  .max(2000)
  .nullable()
  .transform((v) => (v && v.trim() ? v.trim() : null))
  .optional();

/**
 * A URL we are willing to render.
 *
 * `.url()` alone is not enough: it checks that a string PARSES as a URL, and
 * `javascript:alert(1)` parses fine. Stored, it becomes a link on somebody's
 * ticket page. Every URL field in this file goes through the scheme check.
 */
const httpUrl = z
  .string()
  .max(500)
  .refine(isSafeHttpUrl, "Links have to start with http:// or https://");

const optionalUrl = z
  .union([httpUrl, z.literal("")])
  .nullable()
  .transform((v) => (v ? v : null))
  .optional();

const updateEventSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  category: z.string().max(100).optional(),
  coverImage: httpUrl.nullish(),
  venueName: z.string().max(200).optional(),
  venueAddress: z.string().optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  startDatetime: z.coerce.date().optional(),
  endDatetime: z.coerce.date().optional(),
  salesStart: z.coerce.date().optional(),
  salesEnd: z.coerce.date().optional(),
  feeStrategy: z.enum(["buyer_pays", "organizer_absorbs"]).optional(),
  platformFeePaidBy: z.enum(["organizer", "buyer"]).optional(),

  /**
   * "Not confirmed yet." The date and venue are still stored — see the
   * schema comments — these say not to show them to anybody.
   */
  dateTbd: z.boolean().optional(),
  venueTbd: z.boolean().optional(),

  /**
   * What buyers are told after they pay. Never rendered on the public page —
   * see the column comments in the schema for why that matters.
   *
   * An empty string comes back as null rather than "", so clearing the field
   * in the form actually clears it instead of storing a blank the ticket
   * page then has to decide whether to render.
   */
  afterPurchaseNote: optionalNote,
  afterPurchaseUrl: optionalUrl,

  /**
   * The organiser's own mark, separate from this event's cover art.
   */
  logoUrl: optionalUrl,

  /**
   * Extra banner media. The YouTube URL is stored as the organiser gave it
   * and parsed at render time rather than normalised here, so that improving
   * the parser later fixes links already saved instead of only new ones.
   */
  gallery: z
    .array(
      z.object({
        kind: z.enum(["image", "youtube"]),
        // A gallery image is an <img src>; a youtube entry is a link the
        // parser turns into an id. Both have to be fetchable over http(s).
        url: httpUrl,
      })
    )
    .max(MAX_GALLERY)
    .optional(),

  /**
   * Sponsors and partners. A name and a logo are both required — a nameless
   * logo is unreadable and a logoless name is not a sponsor strip, it's a
   * list — and the link is optional.
   */
  sponsors: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        logoUrl: httpUrl,
        url: z
          .union([httpUrl, z.literal("")])
          .nullish()
          .transform((v) => (v ? v : null)),
      })
    )
    .max(MAX_SPONSORS)
    .optional(),
});

async function loadEventAndMembership(eventId: string, userId: string) {
  const [event] = await db
    .select()
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  if (!event) return { event: null, membership: null };

  const role = await getEventRole(userId, event);
  return { event, membership: role ? { role } : null };
}

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/events/:id — any member of the owning organization can view.
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { event, membership } = await loadEventAndMembership(id, userId);
  if (!event || !membership) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ event });
}

// PATCH /api/events/:id — Owner or Event Manager only.
export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { event, membership } = await loadEventAndMembership(id, userId);
  if (!event) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!membership || !can(membership.role, "event:edit")) {
    return NextResponse.json(
      { error: "You do not have permission to edit this event." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = updateEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const nextStart = parsed.data.startDatetime ?? event.startDatetime;
  const nextEnd = parsed.data.endDatetime ?? event.endDatetime;
  if (nextEnd <= nextStart) {
    return NextResponse.json(
      { error: "endDatetime must be after startDatetime" },
      { status: 400 }
    );
  }

  // Publishing requires a venue and a city. Editing must not be a back door
  // that strips them off an event that is already live and selling.
  //
  // Unless the organiser has said the venue is openly to be announced, which
  // is a different thing from leaving the field blank and hoping nobody
  // notices: buyers see "venue to be announced" and get emailed the moment
  // it is confirmed. The city is still required either way — "somewhere in
  // Calabar, venue TBA" is a decision somebody can act on; "somewhere in
  // Nigeria" is not.
  if (event.status === "published") {
    const nextVenue = parsed.data.venueName ?? event.venueName;
    const nextCity = parsed.data.city ?? event.city;
    const venueTbd = parsed.data.venueTbd ?? event.venueTbd;
    if ((!nextVenue?.trim() && !venueTbd) || !nextCity?.trim()) {
      return NextResponse.json(
        {
          error:
            "A published event needs a city, and either a venue or the “venue not confirmed yet” switch. Unpublish it first if you need to clear them.",
        },
        { status: 400 }
      );
    }
  }

  const [updated] = await db
    .update(events)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(events.id, id))
    .returning();

  /**
   * Tell everyone holding a ticket, if the change is one that affects them.
   *
   * Computed from `event` (loaded before the write) against `updated`, so it
   * reflects what actually landed rather than what was asked for — a field
   * the schema quietly dropped must not generate an email claiming it moved.
   *
   * Awaited rather than fired and forgotten: this runs on a serverless
   * platform that kills the process the moment a response goes out, so
   * anything not awaited here is an email that silently never sends. It
   * costs the organiser a second on a save they make rarely, and it cannot
   * fail the save — notifyDetailsChanged swallows its own errors.
   */
  const changes = describeChanges(event, updated);
  const notice = changes.length
    ? await notifyDetailsChanged(id, changes)
    : { notified: 0, failures: 0 };

  return NextResponse.json({
    event: updated,
    // Surfaced so the edit form can say "42 ticket-holders were told",
    // which is the difference between an organiser trusting this and an
    // organiser also posting it to WhatsApp just in case.
    notified: notice.notified,
    notifyFailures: notice.failures,
  });
}

// DELETE /api/events/:id — Owner only (destroys attendee/order history).
export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { event, membership } = await loadEventAndMembership(id, userId);
  if (!event) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!membership || !can(membership.role, "event:delete")) {
    return NextResponse.json(
      { error: "Only the organization owner can delete events." },
      { status: 403 }
    );
  }

  await db.delete(events).where(eq(events.id, id));
  return NextResponse.json({ success: true });
}
