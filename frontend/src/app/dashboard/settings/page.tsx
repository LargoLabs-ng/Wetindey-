import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Banknote, ChevronRight, UserPlus } from "lucide-react";
import { db } from "@/db";
import { events, organizations } from "@/db/schema";
import { getSessionUserId } from "@/lib/authz";
import { getOwnedOrganizations, pickSetupTarget } from "@/lib/organiser-setup";
import { OrganizationDetailsForm } from "./details-form";

const card = "rounded-2xl border border-line-dark bg-surface p-5";

/**
 * /dashboard/settings — the organisation itself: name, logo, where the
 * money goes, and who helps.
 *
 * Payout details and team are shown here but managed where they already
 * live. Finance owns the bank account (and its "account changed" alert);
 * each event's Team page owns that event's staff, because staff are added
 * per event on purpose (door crew for one show cannot scan the next). A
 * second editor for either would be a second set of rules to keep in step.
 */
export default async function OrganizationSettingsPage() {
  const userId = await getSessionUserId();
  const owned = userId ? await getOwnedOrganizations(userId) : [];
  const org = pickSetupTarget(owned);

  if (!org) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="text-2xl font-bold text-on-dark">Settings</h1>
        <div className={card}>
          <p className="font-semibold text-on-dark">You don&apos;t run an organisation yet</p>
          <p className="mt-1 text-sm text-on-dark-2">
            The events you help with belong to their organisers. Set up your
            own to host events under your name.
          </p>
          <Link
            href="/organiser/setup?next=%2Fdashboard%2Fsettings"
            className="mt-4 inline-block rounded-lg bg-gold px-4 py-2.5 font-semibold text-canvas hover:bg-gold-deep"
          >
            Set up to host
          </Link>
        </div>
      </div>
    );
  }

  const [[bank], orgEvents] = await Promise.all([
    db
      .select({
        bankName: organizations.bankName,
        bankAccountName: organizations.bankAccountName,
        bankAccountNumber: organizations.bankAccountNumber,
      })
      .from(organizations)
      .where(eq(organizations.id, org.id))
      .limit(1),
    db
      .select({ id: events.id, title: events.title, status: events.status })
      .from(events)
      .where(eq(events.organizationId, org.id))
      .orderBy(desc(events.startDatetime))
      .limit(20),
  ]);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-on-dark">Settings</h1>
        <p className="mt-1 text-sm text-on-dark-2">
          How your organisation appears on event pages and tickets.
        </p>
      </div>

      <OrganizationDetailsForm initialName={org.name} initialLogoUrl={org.logoUrl} />

      <section className={card}>
        <h2 className="flex items-center gap-2 font-bold text-on-dark">
          <Banknote className="h-4 w-4 text-gold" />
          Payout account
        </h2>
        <p className="mt-2 text-sm text-on-dark-2">
          {bank?.bankAccountNumber
            ? `${bank.bankName ?? "Bank"} ···· ${bank.bankAccountNumber.slice(-4)} — ${bank.bankAccountName ?? ""}`
            : "Not added yet. You need it before you can withdraw."}
        </p>
        <Link
          href="/dashboard/finance"
          className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-gold hover:text-gold-deep"
        >
          {bank?.bankAccountNumber ? "Change in Finance" : "Add in Finance"}
          <ChevronRight className="h-4 w-4" />
        </Link>
      </section>

      <section className={card}>
        <h2 className="flex items-center gap-2 font-bold text-on-dark">
          <UserPlus className="h-4 w-4 text-gold" />
          Team
        </h2>
        <p className="mt-2 text-sm text-on-dark-2">
          Helpers are added per event, so door crew for one show can&apos;t
          scan tickets at the next. Pick an event to manage its team.
        </p>
        {orgEvents.length === 0 ? (
          <p className="mt-3 text-sm text-on-dark-3">
            No events yet.{" "}
            <Link href="/dashboard/events/new" className="font-semibold text-gold hover:text-gold-deep">
              Create one
            </Link>
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line-dark overflow-hidden rounded-xl border border-line-dark">
            {orgEvents.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/dashboard/events/${e.id}/team`}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm transition-colors hover:bg-surface-2"
                >
                  <span className="min-w-0 truncate font-medium text-on-dark">{e.title}</span>
                  <span className="flex shrink-0 items-center gap-2 text-on-dark-3">
                    <span className="capitalize">{e.status}</span>
                    <ChevronRight className="h-4 w-4" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
