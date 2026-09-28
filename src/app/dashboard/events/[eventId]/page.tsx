import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { ArrowLeft, CalendarDays, MapPin, Pencil, QrCode, UserPlus, Users, Wallet } from "lucide-react";
import { db } from "@/db";
import { eventStaff, orders, tickets, ticketTypes, users } from "@/db/schema";
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
  // The grant, not just the role: a Viewer with the money switch on must
  // see the payouts tool, and an Editor without it must not.
  const { event, role, canSeeFinances } = access;
  const grant = { canSeeFinances };

  const tiers = await db
    .select()
    .from(ticketTypes)
    .where(eq(ticketTypes.eventId, event.id));

  /**
   * Who sold what.
   *
   * A left join from the staff row, not from the orders: a promoter who has
   * sold nothing yet still has to appear, with a zero next to their name.
   * Listing only the ones with sales would quietly hide the people the
   * organiser most needs to chase.
   *
   * Gated on attendees:view — knowing who brought whom is guest-list
   * knowledge, not money. Finance can see the revenue without seeing this.
   */
  const promoters = can(role, "attendees:view", grant)
    ? await db
        .select({
          name: users.name,
          firstName: users.firstName,
          lastName: users.lastName,
          refCode: eventStaff.refCode,
          sold: sql<number>`count(${tickets.id})::int`,
          faceValue: sql<number>`coalesce(sum(${orders.subtotal}), 0)::float`,
        })
        .from(eventStaff)
        .innerJoin(users, eq(users.id, eventStaff.userId))
        .leftJoin(
          orders,
          and(
            eq(orders.promoterId, eventStaff.userId),
            eq(orders.eventId, event.id),
            eq(orders.status, "paid")
          )
        )
        .leftJoin(tickets, eq(tickets.orderId, orders.id))
        .where(
          and(
            eq(eventStaff.eventId, event.id),
            eq(eventStaff.role, "promoter"),
            eq(eventStaff.status, "active")
          )
        )
        .groupBy(
          users.name,
          users.firstName,
          users.lastName,
          eventStaff.refCode
        )
        .orderBy(desc(sql`count(${tickets.id})`))
    : [];

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
  ].filter((tool) => can(role, tool.cap, grant));

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

        {can(role, "event:edit", grant) && (
          <div className="flex flex-col items-start gap-3 sm:items-end">
            <PublishToggle eventId={event.id} status={event.status} />
            <Link
              href={`/dashboard/events/${event.id}/edit`}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-on-dark-2 transition-colors hover:text-gold"
            >
              <Pencil className="h-4 w-4" />
              Edit details
            </Link>
          </div>
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

      {can(role, "tickets:manage", grant) && (
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

      {promoters.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-4 font-bold text-on-dark">Promoters</h2>
          <div className="overflow-hidden rounded-2xl border border-line-dark bg-surface">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line-dark text-on-dark-3">
                  <th className="px-5 py-3 font-semibold">Who</th>
                  <th className="px-5 py-3 font-semibold">Code</th>
                  <th className="px-5 py-3 text-right font-semibold">Tickets</th>
                  <th className="px-5 py-3 text-right font-semibold">Value</th>
                </tr>
              </thead>
              <tbody>
                {promoters.map((p) => (
                  <tr
                    key={p.refCode ?? p.name}
                    className="border-b border-line-dark last:border-0"
                  >
                    <td className="px-5 py-3 font-semibold text-on-dark">
                      {[p.firstName, p.lastName].filter(Boolean).join(" ") ||
                        p.name ||
                        "Someone"}
                    </td>
                    <td className="px-5 py-3 font-mono text-on-dark-2">
                      {p.refCode ?? "—"}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-on-dark">
                      {p.sold}
                    </td>
                    <td className="px-5 py-3 text-right text-on-dark-2">
                      ₦{p.faceValue.toLocaleString("en-NG")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Said here as well as on the promoter's own page, because this is
              the table someone will read before paying a person. */}
          <p className="mt-2 text-xs text-on-dark-3">
            Face value of tickets sold, not commission owed — Wetin Dey
            doesn&apos;t calculate or pay promoter commission.
          </p>
        </section>
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
