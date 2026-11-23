/**
 * Phase 1 notifications: organizers and admins.
 *
 * Each handler reads CURRENT data when the notification is built (so a
 * deleted event or a removed team member is simply skipped) and returns who
 * gets what. Preferences, dedupe and sending are handled by the fan-out and
 * the worker.
 *
 * Emails: Phase 1 adds notification emails only where none exist today
 * (payment reviews, the notification health warning). Payout requests,
 * payout updates and bank changes already send their own emails
 * (lib/payout-emails.ts), so here they get the bell only — those emails move
 * onto this system in Phase 5, without ever being sent twice. Organizer sale
 * emails are the daily summary (Phase 2), never one per sale.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  departments,
  eventMessages,
  events,
  messageReports,
  orders,
  organizations,
  payouts,
  tickets,
  ticketTypes,
  universities,
} from "@/db/schema";
import { appUrl } from "@/lib/app-url";
import { registerHandler, type EventRow, type HandlerResult, type Recipient } from "./registry";
import {
  adminsWithPermission,
  eventTeam,
  organizationOwners,
  superAdmins,
  type Person,
} from "./recipients";
import { renderEmail } from "./templates";

const none: HandlerResult = { recipients: [] };

export function naira(amount: number | string): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  return `₦${(Number.isFinite(n) ? n : 0).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function inAppOnly(
  people: Person[],
  category: Recipient["category"],
  content: NonNullable<Recipient["inApp"]>
): HandlerResult {
  return {
    recipients: people.map((p) => ({
      userId: p.userId,
      email: p.email,
      category,
      inApp: content,
    })),
  };
}

// ── Organizers: sales ─────────────────────────────────────────────────────

async function orderSummary(orderId: string) {
  const [order] = await db
    .select({
      id: orders.id,
      // Ticket money after any discount; leaves out the processing fee the
      // buyer paid on top, which never reaches the organiser.
      subtotal: orders.subtotal,
      // Everything the buyer paid, fees included (for payment reviews).
      total: orders.total,
      status: orders.status,
      eventId: orders.eventId,
      eventTitle: events.title,
    })
    .from(orders)
    .innerJoin(events, eq(events.id, orders.eventId))
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) return null;
  const lines = await db
    .select({ name: ticketTypes.name, count: sql<number>`count(*)::int` })
    .from(tickets)
    .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
    .where(eq(tickets.orderId, orderId))
    .groupBy(ticketTypes.name);
  return { ...order, lines };
}

function salesHandler(kind: "sale" | "rsvp") {
  return {
    async resolve(event: EventRow): Promise<HandlerResult> {
      const orderId = str(event.payload.orderId);
      if (!orderId) return none;
      const order = await orderSummary(orderId);
      // Refunded or cancelled since? Then it's not news any more.
      if (!order || order.status !== "paid") return none;
      const what = order.lines.map((l) => `${l.count} × ${l.name}`).join(", ");
      const body = kind === "sale" ? `${what} · ${naira(order.subtotal)}` : what;
      const team = await eventTeam(order.eventId, "finance:view");
      return inAppOnly(team, "sales", {
        title: `${kind === "sale" ? "New sale" : "New RSVP"} · ${order.eventTitle}`,
        body,
        url: `/dashboard/events/${order.eventId}`,
        data: { orderId, eventId: order.eventId },
      });
    },
  };
}

const tierSoldOut = {
  async resolve(event: EventRow): Promise<HandlerResult> {
    const tierId = str(event.payload.ticketTypeId);
    if (!tierId) return none;
    const [tier] = await db
      .select({
        name: ticketTypes.name,
        status: ticketTypes.status,
        eventId: ticketTypes.eventId,
        eventTitle: events.title,
      })
      .from(ticketTypes)
      .innerJoin(events, eq(events.id, ticketTypes.eventId))
      .where(eq(ticketTypes.id, tierId))
      .limit(1);
    // Reopened (more seats added) before we got to it: nothing to say.
    if (!tier || tier.status !== "sold_out") return none;
    const team = await eventTeam(tier.eventId, "finance:view");
    return inAppOnly(team, "sales", {
      title: `Sold out · ${tier.name}`,
      body: `Every ${tier.name} ticket for ${tier.eventTitle} is gone. Add more seats from the event's ticket settings if you have room.`,
      url: `/dashboard/events/${tier.eventId}`,
      data: { ticketTypeId: tierId, eventId: tier.eventId },
    });
  },
};

// ── Organizers: payouts and account security ─────────────────────────────

const PAYOUT_COPY: Record<string, { title: string; body: (p: { amount: string; note: string | null }) => string }> = {
  approved: {
    title: "Payout approved",
    body: ({ amount }) => `Your payout request for ${amount} was approved. We'll send it to your bank shortly.`,
  },
  processing: {
    title: "Payout on its way",
    body: ({ amount }) => `We've started sending ${amount} to your bank account.`,
  },
  paid: {
    title: "Payout sent",
    body: ({ amount }) => `${amount} has been sent to your bank account.`,
  },
  failed: {
    title: "Payout didn't go through",
    body: ({ note }) => `The transfer didn't go through.${note ? ` ${note}` : ""} We'll try again.`,
  },
  rejected: {
    title: "Payout request declined",
    body: ({ note }) => (note ? `Reason: ${note}` : "Your payout request was declined."),
  },
};

const payoutStatusChanged = {
  async resolve(event: EventRow): Promise<HandlerResult> {
    const payoutId = str(event.payload.payoutId);
    const to = str(event.payload.to);
    const copy = to ? PAYOUT_COPY[to] : undefined;
    if (!payoutId || !copy) return none;
    const [payout] = await db
      .select({ organizationId: payouts.organizationId, netAmount: payouts.netAmount, note: payouts.note })
      .from(payouts)
      .where(eq(payouts.id, payoutId))
      .limit(1);
    if (!payout) return none;
    const owners = await organizationOwners(payout.organizationId);
    return inAppOnly(owners, "payouts", {
      title: copy.title,
      body: copy.body({ amount: naira(payout.netAmount), note: payout.note }),
      url: "/dashboard/finance",
      data: { payoutId, status: to },
    });
  },
};

const bankChanged = {
  async resolve(event: EventRow): Promise<HandlerResult> {
    const organizationId = str(event.payload.organizationId);
    if (!organizationId) return none;
    const [org] = await db
      .select({ bankName: organizations.bankName, accountNumber: organizations.bankAccountNumber })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!org) return none;
    const last4 = org.accountNumber ? org.accountNumber.slice(-4) : null;
    const owners = await organizationOwners(organizationId);
    return inAppOnly(owners, "account_security", {
      title: "Payout bank account changed",
      body: `Payouts now go to ${org.bankName ?? "a new bank"}${last4 ? ` (account ending ${last4})` : ""}. If this wasn't you, change your password and contact support straight away.`,
      url: "/dashboard/finance",
      data: { organizationId },
    });
  },
};

// ── Admins ───────────────────────────────────────────────────────────────

const payoutRequested = {
  async resolve(event: EventRow): Promise<HandlerResult> {
    const payoutId = str(event.payload.payoutId);
    if (!payoutId) return none;
    const [payout] = await db
      .select({ status: payouts.status, netAmount: payouts.netAmount, organization: organizations.name })
      .from(payouts)
      .innerJoin(organizations, eq(organizations.id, payouts.organizationId))
      .where(eq(payouts.id, payoutId))
      .limit(1);
    if (!payout || payout.status !== "pending") return none;
    const admins = await adminsWithPermission("payouts.view");
    return inAppOnly(admins, "admin_actions", {
      title: "Payout request waiting",
      body: `${payout.organization} asked for ${naira(payout.netAmount)}.`,
      url: `/admin/payouts/${payoutId}`,
      data: { payoutId },
    });
  },
};

const paymentReview = {
  async resolve(event: EventRow): Promise<HandlerResult> {
    const orderId = str(event.payload.orderId);
    const reason = str(event.payload.reason) === "late_payment" ? "late_payment" : "price_changed";
    if (!orderId) return none;
    const order = await orderSummary(orderId);
    if (!order) return none;
    const why =
      reason === "late_payment"
        ? "The payment arrived after the seats were released, and the tickets had sold out."
        : "The ticket price changed while the buyer was paying.";
    const title = `Payment needs review · ${order.eventTitle}`;
    const body = `${naira(order.total)} was paid but no ticket was issued. ${why} Refund or resolve it.`;
    const url = "/admin/payment-reviews";
    const html = renderEmail({
      preheader: body,
      title,
      paragraphs: [body],
      cta: { label: "Open payment reviews", url: appUrl(url) },
    });
    const admins = await superAdmins();
    return {
      recipients: admins.map((a) => ({
        userId: a.userId,
        email: a.email,
        category: "admin_actions" as const,
        inApp: { title, body, url, data: { orderId } },
        emailContent: { subject: title, html },
      })),
    };
  },
};

const departmentPending = {
  async resolve(event: EventRow): Promise<HandlerResult> {
    const departmentId = str(event.payload.departmentId);
    if (!departmentId) return none;
    const [dept] = await db
      .select({ name: departments.name, status: departments.status, university: universities.shortName })
      .from(departments)
      .innerJoin(universities, eq(universities.id, departments.universityId))
      .where(eq(departments.id, departmentId))
      .limit(1);
    if (!dept || dept.status !== "pending") return none;
    const admins = await superAdmins();
    return inAppOnly(admins, "admin_actions", {
      title: "Department waiting for approval",
      body: `A student added “${dept.name}” at ${dept.university}.`,
      url: "/admin/departments",
      data: { departmentId },
    });
  },
};

const messageReported = {
  async resolve(event: EventRow): Promise<HandlerResult> {
    const reportId = str(event.payload.reportId);
    if (!reportId) return none;
    const [report] = await db
      .select({
        reason: messageReports.reason,
        status: messageReports.status,
        eventId: eventMessages.eventId,
        eventTitle: events.title,
        eventSlug: events.slug,
      })
      .from(messageReports)
      .innerJoin(eventMessages, eq(eventMessages.id, messageReports.messageId))
      .innerJoin(events, eq(events.id, eventMessages.eventId))
      .where(eq(messageReports.id, reportId))
      .limit(1);
    if (!report || report.status !== "open") return none;
    const reason = String(report.reason).replace(/_/g, " ");
    const team = await eventTeam(report.eventId, "event:edit");
    const admins = await superAdmins();
    const recipients: Recipient[] = [
      ...team.map((p) => ({
        userId: p.userId,
        email: p.email,
        category: "moderation" as const,
        inApp: {
          title: `Message reported · ${report.eventTitle}`,
          body: `Someone reported a message in your event's conversation (${reason}). Take a look.`,
          url: `/events/${report.eventSlug}`,
          data: { reportId, eventId: report.eventId },
        },
      })),
      ...admins
        .filter((a) => !team.some((p) => p.userId === a.userId))
        .map((a) => ({
          userId: a.userId,
          email: a.email,
          category: "admin_actions" as const,
          inApp: {
            title: `Message reported · ${report.eventTitle}`,
            body: `A message was reported (${reason}).`,
            url: `/events/${report.eventSlug}`,
            data: { reportId, eventId: report.eventId },
          },
        })),
    ];
    return { recipients };
  },
};

const platformHealth = {
  async resolve(event: EventRow): Promise<HandlerResult> {
    const failed = Number(event.payload.failedLast24h ?? 0);
    const oldestMinutes = Number(event.payload.oldestWaitingMinutes ?? 0);
    const title = "Notifications need attention";
    const body =
      `${failed} notification${failed === 1 ? "" : "s"} failed in the last 24 hours` +
      (oldestMinutes > 0 ? `, and the oldest waiting one has waited ${oldestMinutes} minutes` : "") +
      ". Check the delivery health page.";
    const url = "/admin/notifications";
    const html = renderEmail({ title, paragraphs: [body], cta: { label: "Open delivery health", url: appUrl(url) } });
    const admins = await superAdmins();
    return {
      recipients: admins.map((a) => ({
        userId: a.userId,
        email: a.email,
        category: "platform_health" as const,
        inApp: { title, body, url },
        emailContent: { subject: title, html },
      })),
    };
  },
};

/** Registers every built-in handler. Idempotent; called at the start of each run. */
export function registerBuiltInHandlers(): void {
  registerHandler("order.paid", salesHandler("sale"));
  registerHandler("order.confirmed", salesHandler("rsvp"));
  registerHandler("tier.sold_out", tierSoldOut);
  registerHandler("payout.status_changed", payoutStatusChanged);
  registerHandler("org.bank_changed", bankChanged);
  registerHandler("payout.requested", payoutRequested);
  registerHandler("payment.review", paymentReview);
  registerHandler("department.pending", departmentPending);
  registerHandler("message.reported", messageReported);
  registerHandler("platform.health", platformHealth);
}
