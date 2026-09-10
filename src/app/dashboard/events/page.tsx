import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";
import { getPrimaryOrganizationId, getSessionUserId } from "@/lib/authz";

const statusStyles: Record<string, string> = {
  draft: "bg-surface-2 text-on-dark-2",
  published: "bg-success/25 text-sage",
  unpublished: "bg-warning/15 text-warning",
  cancelled: "bg-error/15 text-error",
};

export default async function EventsPage() {
  const userId = await getSessionUserId();
  const organizationId = userId ? await getPrimaryOrganizationId(userId) : null;

  const orgEvents = organizationId
    ? await db
        .select()
        .from(events)
        .where(eq(events.organizationId, organizationId))
        .orderBy(desc(events.startDatetime))
    : [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-on-dark">Your events</h1>
          <p className="text-on-dark-2 text-sm mt-1">
            Everything under control.
          </p>
        </div>
        <Link
          href="/dashboard/events/new"
          className="rounded-lg bg-gold text-canvas font-semibold px-4 py-2.5 hover:bg-gold-deep transition-colors"
        >
          Create event
        </Link>
      </div>

      {orgEvents.length === 0 ? (
        <div className="bg-surface border border-line-dark rounded-2xl p-12 text-center">
          <p className="text-on-dark font-medium mb-1">No events yet</p>
          <p className="text-on-dark-2 text-sm mb-6">
            Create your first event to start selling tickets.
          </p>
          <Link
            href="/dashboard/events/new"
            className="inline-block rounded-lg bg-gold text-canvas font-semibold px-4 py-2.5 hover:bg-gold-deep transition-colors"
          >
            Create event
          </Link>
        </div>
      ) : (
        <div className="bg-surface border border-line-dark rounded-2xl divide-y divide-line-dark overflow-hidden">
          {orgEvents.map((event) => (
            <Link
              key={event.id}
              href={`/dashboard/events/${event.id}`}
              className="flex items-center justify-between px-6 py-4 hover:bg-surface-2 transition-colors"
            >
              <div>
                <p className="font-semibold text-on-dark">{event.title}</p>
                <p className="text-sm text-on-dark-2">
                  {new Date(event.startDatetime).toLocaleDateString("en-NG", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                  {event.city ? ` · ${event.city}` : ""}
                </p>
              </div>
              <span
                className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize ${
                  statusStyles[event.status] ?? statusStyles.draft
                }`}
              >
                {event.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
