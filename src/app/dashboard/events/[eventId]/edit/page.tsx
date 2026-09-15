import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireEventCapability } from "@/lib/authz";
import { EventEditForm } from "@/components/event-edit-form";

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;

  const access = await requireEventCapability(eventId, "event:edit");
  if (!access.ok) notFound();
  const { event } = access;

  return (
    <div className="space-y-8">
      <Link
        href={`/dashboard/events/${event.id}`}
        className="inline-flex items-center gap-2 text-sm text-on-dark-2 transition-colors hover:text-on-dark"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to event
      </Link>

      <header>
        <h1 className="text-2xl font-bold tracking-tight text-on-dark">
          Edit event
        </h1>
        <p className="mt-1 text-on-dark-2">{event.title}</p>
      </header>

      <EventEditForm
        event={{
          id: event.id,
          title: event.title,
          description: event.description,
          category: event.category,
          coverImage: event.coverImage,
          venueName: event.venueName,
          venueAddress: event.venueAddress,
          city: event.city,
          country: event.country,
          startDatetime: event.startDatetime.toISOString(),
          endDatetime: event.endDatetime.toISOString(),
          status: event.status,
        }}
      />
    </div>
  );
}
