import Link from "next/link";
import { CalendarDays, QrCode } from "lucide-react";
import { getSessionUserId, getStaffedEvents } from "@/lib/authz";
import { can } from "@/lib/permissions";
import { redirect } from "next/navigation";

export default async function CheckInEventPicker() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login?callbackUrl=/checkin");

  const staffed = (await getStaffedEvents(userId)).filter((e) =>
    can(e.role, "checkin:perform")
  );

  // Nothing to choose between — go straight to the scanner.
  if (staffed.length === 1) {
    redirect(`/checkin/${staffed[0].id}`);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-on-dark">
          Pick an event
        </h1>
        <p className="mt-1 text-on-dark-2">
          Choose the door you&apos;re working.
        </p>
      </div>

      {staffed.length === 0 ? (
        <div className="rounded-2xl border border-line-dark bg-surface p-10 text-center">
          <QrCode className="mx-auto mb-3 h-8 w-8 text-on-dark-3" />
          <p className="font-medium text-on-dark">
            You&apos;re not on any event yet
          </p>
          <p className="mt-1 text-sm text-on-dark-2">
            Ask the organizer to add you to the event you&apos;re working.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {staffed.map((event) => (
            <li key={event.id}>
              <Link
                href={`/checkin/${event.id}`}
                className="flex items-center justify-between gap-4 rounded-2xl border border-line-dark bg-surface p-5 transition-colors hover:border-gold hover:bg-surface-2"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-on-dark">{event.title}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-on-dark-2">
                    <CalendarDays className="h-4 w-4 shrink-0 text-on-dark-3" />
                    {new Date(event.startDatetime).toLocaleDateString("en-NG", {
                      weekday: "short",
                      day: "numeric",
                      month: "long",
                    })}
                  </p>
                </div>
                <QrCode className="h-6 w-6 shrink-0 text-gold" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
