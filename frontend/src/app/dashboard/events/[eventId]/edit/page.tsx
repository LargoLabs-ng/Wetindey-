import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireEventCapability } from "@/lib/authz";
import { EventEditForm } from "@/components/event-edit-form";
import { AfterPurchaseFields } from "@/components/after-purchase-fields";
import { EventBrandingFields } from "@/components/event-branding-fields";
import { PromoCodesEditor } from "@/components/promo-codes-editor";
import { RegistrationFieldsEditor } from "@/components/registration-fields-editor";

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
          dateTbd: event.dateTbd,
          venueTbd: event.venueTbd,
        }}
      />

      {/* Editable after publishing on purpose. An organiser realises on day
          three that they should have asked for department, and the answer to
          that should be "add it", not "too late". Answers already given keep
          the label they were given under. */}
      <section className="rounded-2xl border border-line-dark bg-surface p-6">
        <RegistrationFieldsEditor eventId={event.id} />
      </section>

      <section className="rounded-2xl border border-line-dark bg-surface p-6">
        <AfterPurchaseFields eventId={event.id} />
      </section>

      <section className="rounded-2xl border border-line-dark bg-surface p-6">
        <EventBrandingFields eventId={event.id} />
      </section>

      <section className="rounded-2xl border border-line-dark bg-surface p-6">
        <PromoCodesEditor eventId={event.id} />
      </section>
    </div>
  );
}
