import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft, CalendarDays, MapPin, QrCode, UserPlus, Users, Wallet } from "lucide-react";
import { db } from "@/db";
import { ticketTypes } from "@/db/schema";
import { requireEventCapability } from "@/lib/authz";
import { can } from "@/lib/permissions";
import { PublishToggle } from "@/components/publish-toggle";
import { TicketTiers } from "@/components/ticket-tiers";

const statusStyles: Record<string, string> = {
  draft: "bg-surface-2 text-on-dark-2",
  published: "bg-success/25 text-sage",
  unpublished: "bg-warning/15 text-warning",
  cancelled: "bg-error/15 text-error",
};

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;

  const access = await requireEventCapability(eventId, "event:view");
  if (!access.ok) notFound();
  const { event, role } = access;

  const tiers = await db
    .select()
    .from(ticketTypes)
    .where(eq(ticketTypes.eventId, event.id));

  const dateLabel = new Date(event.startDatetime).toLocaleString("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const tools = [
    { href: `/dashboard/events/${event.id}/attendees`, icon: Users, label: "Attendees", cap: "attendees:view" as const },
    { href: `/dashboard/events/${event.id}/check-in`, icon: QrCode, label: "Check-in", cap: "checkin:perform" as const },
    { href: `/dashboard/events/${event.id}/payouts`, icon: Wallet, label: "Payouts", cap: "finance:view" as const },
    { href: `/dashboard/events/${event.id}/team`, icon: UserPlus, label: "Team", cap: "team:manage" as const },
  ].filter((tool) => can(role, tool.cap));

  return (
    <div className="space-y-8">
      <Link
        href="/dashboard/events"
        className="inline-flex items-center gap-2 text-sm text-on-dark-2 transition-colors hover:text-on-dark"
      >
        <ArrowLeft className="h-4 w-4" />
        All events
      </Link>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-3">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${
                statusStyles[event.status] ?? statusStyles.draft
              }`}
            >
              {event.status}
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-on-dark">
            {event.title}
          </h1>
          <div className="mt-3 space-y-1.5 text-sm text-on-dark-2">
            <p className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 shrink-0 text-on-dark-3" />
              {dateLabel}
            </p>
            <p className="flex items-center gap-2">
              <MapPin className="h-4 w-4 shrink-0 text-on-dark-3" />
              {[event.venueName, event.city].filter(Boolean).join(", ") ||
                "No venue set yet"}
            </p>
          </div>
        </div>

        {can(role, "event:edit") && (
          <PublishToggle eventId={event.id} status={event.status} />
        )}
      </header>

      {event.status === "published" && (
        <div className="flex flex-col gap-3 rounded-2xl border border-line-dark bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-on-dark">Your event is live</p>
            <p className="text-sm text-on-dark-2">
              Share this link and people can start buying.
            </p>
          </div>
          <Link
            href={`/events/${event.slug}`}
            className="shrink-0 rounded-lg border border-line-dark px-4 py-2 text-sm font-semibold text-on-dark transition-colors hover:border-gold hover:text-gold"
          >
            View public page
          </Link>
        </div>
      )}

      {can(role, "tickets:manage") && (
      <TicketTiers
        eventId={event.id}
        tiers={tiers.map((tier) => ({
          id: tier.id,
          name: tier.name,
          description: tier.description,
          price: tier.price,
          quantityTotal: tier.quantityTotal,
          quantitySold: tier.quantitySold,
          maxPerOrder: tier.maxPerOrder,
          status: tier.status,
          salesStart: tier.salesStart ? tier.salesStart.toISOString() : null,
          salesEnd: tier.salesEnd ? tier.salesEnd.toISOString() : null,
        }))}
      />
      )}

      <section>
        <h2 className="mb-4 font-bold text-on-dark">Event tools</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tools.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="rounded-2xl border border-line-dark bg-surface p-5 transition-colors hover:border-gold hover:bg-surface-2"
            >
              <tool.icon className="mb-3 h-6 w-6 text-gold" />
              <p className="font-semibold text-on-dark">{tool.label}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
