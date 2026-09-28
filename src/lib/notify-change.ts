import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { events, orders } from "@/db/schema";
import { sendEventDetailsChanged } from "@/lib/email-service";
import { appUrl } from "@/lib/app-url";

/**
 * Telling ticket-holders when the plan changes.
 *
 * This is the half of "post before the details are fixed" that makes the
 * other half safe to offer. An organiser can only be encouraged to publish
 * with a provisional venue if everyone who bought finds out the moment it
 * stops being provisional — otherwise we have built a machine for sending
 * students to the wrong building.
 *
 * `describeChanges` is pure and lives here rather than in the route so the
 * rules about what counts as a change are testable, and in one place.
 */

export type EventChange = {
  /** What moved, in the words a buyer would use. */
  label: string;
  from: string;
  to: string;
};

/** The subset of an event that changes somebody's evening. */
export type NotifiableDetails = {
  startDatetime: Date | string | null;
  endDatetime: Date | string | null;
  venueName: string | null;
  venueAddress: string | null;
  city: string | null;
  /**
   * When these are on, the stored date and venue are provisional and nobody
   * has been shown them. Everything below reads them as "not announced yet"
   * regardless of what is stored — so an organiser shuffling a provisional
   * date around sends no email at all, and confirming it sends exactly one.
   */
  dateTbd?: boolean | null;
  venueTbd?: boolean | null;
};

const NOT_SET = "not announced yet";

function formatWhen(value: Date | string | null | undefined): string {
  if (!value) return NOT_SET;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return NOT_SET;
  return d.toLocaleString("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatText(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  return text || NOT_SET;
}

// Comparison is on the FORMATTED value, not the underlying instant. Two
// times that print the same have not changed as far as anyone reading this
// email is concerned, and a thirty-second shift is not worth four hundred
// notifications.

/**
 * What changed, from a buyer's point of view.
 *
 * Deliberately narrow. A new cover image, a tightened description, a fixed
 * typo in the title — none of those are a reason to put an email in four
 * hundred inboxes, and an alert that fires for everything is an alert people
 * learn to ignore before the one that matters arrives.
 *
 * The end time is included even though it moves nobody's plans much, because
 * an organiser who shortens an event by four hours has changed what people
 * bought.
 */
export function describeChanges(
  before: NotifiableDetails,
  after: NotifiableDetails
): EventChange[] {
  const changes: EventChange[] = [];

  // What a buyer was actually shown, which is not the same as what is
  // stored. A provisional date reads as unannounced on both sides, so
  // shuffling one produces no change at all — and confirming it produces
  // exactly one, reading "not announced yet → Fri 12 December".
  const when = (d: NotifiableDetails, key: "startDatetime" | "endDatetime") =>
    d.dateTbd ? NOT_SET : formatWhen(d[key]);

  const place = (d: NotifiableDetails, key: "venueName" | "venueAddress") =>
    d.venueTbd ? NOT_SET : formatText(d[key]);

  const startBefore = when(before, "startDatetime");
  const startAfter = when(after, "startDatetime");
  if (startBefore !== startAfter) {
    changes.push({ label: "Starts", from: startBefore, to: startAfter });
  }

  const endBefore = when(before, "endDatetime");
  const endAfter = when(after, "endDatetime");
  if (endBefore !== endAfter) {
    changes.push({ label: "Ends", from: endBefore, to: endAfter });
  }

  const venueBefore = place(before, "venueName");
  const venueAfter = place(after, "venueName");
  if (venueBefore !== venueAfter) {
    changes.push({ label: "Venue", from: venueBefore, to: venueAfter });
  }

  const addressBefore = place(before, "venueAddress");
  const addressAfter = place(after, "venueAddress");
  if (addressBefore !== addressAfter) {
    changes.push({ label: "Address", from: addressBefore, to: addressAfter });
  }

  // The city is shown even while the exact venue is provisional — "somewhere
  // in Calabar, venue TBA" is a useful thing to know — so it is compared on
  // its own terms. Trimmed, because a trailing space somebody's keyboard
  // added is not a change worth an email.
  if ((before.city ?? "").trim() !== (after.city ?? "").trim()) {
    changes.push({
      label: "City",
      from: formatText(before.city),
      to: formatText(after.city),
    });
  }

  return changes;
}

export type NotifyResult = { notified: number; failures: number };

/**
 * Email every buyer who is still holding a ticket.
 *
 * One email per ADDRESS, not per order or per ticket: somebody who bought
 * five tickets for their friends, or who came back and bought again, gets
 * told once.
 *
 * Never throws. A failure to send has to leave the event edit itself
 * standing — the change is already saved and correct, and an organiser
 * seeing "could not save" after a successful save is how you end up with the
 * date entered twice.
 */
export async function notifyDetailsChanged(
  eventId: string,
  changes: EventChange[]
): Promise<NotifyResult> {
  const result: NotifyResult = { notified: 0, failures: 0 };
  if (changes.length === 0) return result;

  try {
    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
    });
    if (!event) return result;

    // Drafts have no buyers by definition, and a cancelled event has already
    // had its own, much louder, email.
    if (event.status !== "published") return result;

    const paid = await db
      .select({ email: orders.email })
      .from(orders)
      .where(and(eq(orders.eventId, eventId), eq(orders.status, "paid")));

    const addresses = [...new Set(paid.map((o) => o.email).filter(Boolean))];

    for (const email of addresses) {
      try {
        const sent = await sendEventDetailsChanged({
          to: email,
          eventTitle: event.title,
          changes,
          eventUrl: appUrl(`/events/${event.slug}`),
        });
        if (sent) result.notified += 1;
        else result.failures += 1;
      } catch (error) {
        result.failures += 1;
        console.error(`Change notice failed for ${email}:`, error);
      }
    }
  } catch (error) {
    console.error(`Change notices failed for event ${eventId}:`, error);
  }

  return result;
}
