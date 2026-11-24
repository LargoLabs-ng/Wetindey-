/**
 * The daily summary emails, built on the morning run (8 AM Lagos).
 *
 * - digest.sales_daily: one email per person on an event's money team
 *   (the owner and staff allowed to see finances), covering all their
 *   events for yesterday. Nothing on a day without sales.
 * - digest.admin_daily: one email per Super Admin, only on mornings when
 *   something is waiting on them.
 *
 * Each is recorded once per Lagos date (the key is the date), so the backup
 * run later in the morning never sends a second copy. Payloads carry the
 * window, so a retry hours later still summarises the same day.
 *
 * Both are switched on by NOTIFICATIONS_DIGESTS_ENABLED. The admin "Send me
 * a test summary" button works even while it's off, and only ever emails
 * the admin who pressed it.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { appUrl } from "@/lib/app-url";
import { notificationHealth } from "./health";
import { naira } from "./handlers";
import { recordEvent, type Executor as Db } from "./outbox";
import { eventTeam, superAdmins, type Person } from "./recipients";
import { registerHandler, type EventRow, type HandlerResult, type Recipient } from "./registry";
import { renderEmail } from "./templates";
import { startOfLagosDay } from "./config";

/** The emails stop at the daily limit like any summary; this is the switch. */
export function digestsEnabled(): boolean {
  return process.env.NOTIFICATIONS_DIGESTS_ENABLED === "true";
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Longer lists are cut off with "and N more". */
const MAX_EVENTS_LISTED = 10;

type Window = { from: string; to: string; label: string };

const lagosLabel = (d: Date) =>
  new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short" }).format(d);
const lagosDate = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(d); // YYYY-MM-DD

/** Yesterday, midnight to midnight in Lagos. */
export function yesterdayWindow(now: Date = new Date()): Window & { date: string } {
  const to = startOfLagosDay(now);
  const from = new Date(to.getTime() - DAY_MS);
  return { from: from.toISOString(), to: to.toISOString(), label: lagosLabel(from), date: lagosDate(from) };
}

// ── What sold ───────────────────────────────────────────────────────────────

export type EventDay = { eventId: string; title: string; tickets: number; rsvps: number; sales: number };

/**
 * Per event, for orders confirmed inside the window: paid tickets, free
 * RSVPs, and ticket sales (each live ticket's share of its order subtotal,
 * so after discounts and refunds, without the processing fee: the same
 * figure as the dashboard). A sale counts from when its payment was
 * confirmed; a free order from when it was made.
 */
export async function salesInWindow(win: { from: string; to: string }): Promise<EventDay[]> {
  const rows = (await db.execute(sql`
    WITH sold AS (
      SELECT o.id AS order_id, o.event_id, o.subtotal
      FROM orders o
      LEFT JOIN LATERAL (
        SELECT max(p.paid_at) AS paid_at FROM payments p WHERE p.order_id = o.id AND p.status = 'success'
      ) p ON true
      WHERE o.status = 'paid'
        -- Stored as UTC without a zone label, so compare in UTC explicitly.
        AND coalesce(p.paid_at, o.created_at) >= (${win.from}::timestamptz AT TIME ZONE 'UTC')
        AND coalesce(p.paid_at, o.created_at) <  (${win.to}::timestamptz AT TIME ZONE 'UTC')
    )
    SELECT s.event_id, e.title,
      (count(*) FILTER (WHERE tt.price > 0))::int AS tickets,
      (count(*) FILTER (WHERE tt.price = 0))::int AS rsvps,
      coalesce(round(sum(s.subtotal / oc.n), 2), 0)::float AS sales
    FROM sold s
    JOIN LATERAL (SELECT count(*) AS n FROM tickets WHERE order_id = s.order_id) oc ON true
    JOIN tickets t ON t.order_id = s.order_id AND t.status IN ('valid', 'checked_in')
    JOIN ticket_types tt ON tt.id = t.ticket_type_id
    JOIN events e ON e.id = s.event_id
    GROUP BY s.event_id, e.title
    ORDER BY sales DESC, tickets DESC, e.title`)) as unknown as Array<{
    event_id: string;
    title: string;
    tickets: number;
    rsvps: number;
    sales: number;
  }>;
  return rows.map((r) => ({ eventId: r.event_id, title: r.title, tickets: r.tickets, rsvps: r.rsvps, sales: r.sales }));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function dayLine(d: { tickets: number; rsvps: number; sales: number }): string {
  const parts: string[] = [];
  if (d.tickets > 0) parts.push(plural(d.tickets, "ticket"), naira(d.sales));
  if (d.rsvps > 0) parts.push(plural(d.rsvps, "RSVP"));
  return parts.join(" · ") || "No sales";
}

/** The email for one person, from their events' days. */
export function salesSummaryEmail(days: EventDay[], label: string, opts: { test?: boolean } = {}) {
  const total = days.reduce(
    (t, d) => ({ tickets: t.tickets + d.tickets, rsvps: t.rsvps + d.rsvps, sales: t.sales + d.sales }),
    { tickets: 0, rsvps: 0, sales: 0 }
  );
  const headline = days.length ? dayLine(total) : "No sales";
  const shown = days.slice(0, MAX_EVENTS_LISTED);
  const paragraphs = shown.map((d) => `${d.title}: ${dayLine(d)}`);
  if (days.length > shown.length) paragraphs.push(`And ${plural(days.length - shown.length, "more event")}.`);
  if (days.length === 0) paragraphs.push("Nothing sold in this period.");
  const prefix = opts.test ? "[Test] " : "";
  const html = renderEmail({
    preheader: `${label}: ${headline}`,
    title: `${opts.test ? "Test summary" : label}: ${headline}`,
    paragraphs,
    cta: { label: "Open your dashboard", url: appUrl("/dashboard") },
    footnote: opts.test
      ? "This is a test of the daily sales email, covering today so far."
      : `Ticket sales after discounts and before fees, for ${label} (Lagos time).`,
  });
  return { subject: `${prefix}${opts.test ? "Today so far" : `Yesterday (${label})`}: ${headline}`, html };
}

/** Everyone who gets a sales summary, with their events, sorted for stable paging. */
async function salesAudience(days: EventDay[]): Promise<Array<{ person: Person; days: EventDay[] }>> {
  const byPerson = new Map<string, { person: Person; days: EventDay[] }>();
  for (const day of days) {
    for (const person of await eventTeam(day.eventId, "finance:view")) {
      const entry = byPerson.get(person.userId) ?? { person, days: [] };
      entry.days.push(day);
      byPerson.set(person.userId, entry);
    }
  }
  return [...byPerson.values()].sort((a, b) => (a.person.userId < b.person.userId ? -1 : 1));
}

const salesDaily = {
  async resolve(event: EventRow, cursor: string | null, pageSize: number): Promise<HandlerResult> {
    const win = { from: String(event.payload.from), to: String(event.payload.to) };
    const label = String(event.payload.label ?? "");
    const test = event.payload.test === true;
    const onlyUserId = typeof event.payload.onlyUserId === "string" ? event.payload.onlyUserId : null;

    let audience = await salesAudience(await salesInWindow(win));
    if (onlyUserId) audience = audience.filter((a) => a.person.userId === onlyUserId);
    if (test && onlyUserId && audience.length === 0) {
      // A test still arrives on a quiet day, so the email itself can be checked.
      const [me] = (await db.execute(sql`SELECT id, email, first_name FROM users WHERE id = ${onlyUserId}`)) as unknown as Array<{
        id: string;
        email: string;
        first_name: string | null;
      }>;
      if (me) audience = [{ person: { userId: me.id, email: me.email, firstName: me.first_name }, days: [] }];
    }

    const start = cursor ? Number(cursor) : 0;
    const page = audience.slice(start, start + pageSize);
    const recipients: Recipient[] = page.map(({ person, days }) => ({
      userId: person.userId,
      email: person.email,
      category: "sales",
      inApp: null, // each sale already rang the bell
      emailContent: salesSummaryEmail(days, label, { test }),
    }));
    return { recipients, nextCursor: start + pageSize < audience.length ? String(start + pageSize) : null };
  },
};

// ── Admin summary ───────────────────────────────────────────────────────────

export type AdminWaiting = {
  payouts: number;
  paymentReviews: number;
  departments: number;
  reports: number;
  failedNotifications: number;
};

export async function adminWaiting(): Promise<AdminWaiting> {
  const [row] = (await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM payouts WHERE status IN ('pending', 'approved', 'processing', 'failed')) AS payouts,
      (SELECT count(*)::int FROM payments WHERE manual_review_required AND manual_review_resolved_at IS NULL) AS payment_reviews,
      (SELECT count(*)::int FROM departments WHERE status = 'pending') AS departments,
      (SELECT count(*)::int FROM message_reports WHERE status = 'open') AS reports`)) as unknown as Array<{
    payouts: number;
    payment_reviews: number;
    departments: number;
    reports: number;
  }>;
  const health = await notificationHealth();
  return {
    payouts: row?.payouts ?? 0,
    paymentReviews: row?.payment_reviews ?? 0,
    departments: row?.departments ?? 0,
    reports: row?.reports ?? 0,
    failedNotifications: health.failedLast24h,
  };
}

export function adminSummaryEmail(
  waiting: AdminWaiting,
  yesterday: { tickets: number; rsvps: number; sales: number; newEvents: number },
  label: string,
  opts: { test?: boolean } = {}
) {
  const items: Array<[number, string, string]> = [
    [waiting.payouts, "payout request", "payout requests"],
    [waiting.paymentReviews, "payment needs review", "payments need review"],
    [waiting.departments, "department waiting for approval", "departments waiting for approval"],
    [waiting.reports, "reported message to look at", "reported messages to look at"],
    [waiting.failedNotifications, "notification failed in the last 24 hours", "notifications failed in the last 24 hours"],
  ];
  const lines = items.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  const count = lines.length;
  const title = count ? `${plural(count, "thing")} ${count === 1 ? "needs" : "need"} you today` : "Nothing waiting on you";
  const paragraphs = [
    ...lines,
    `${label}: ${dayLine(yesterday)}${yesterday.newEvents ? ` · ${plural(yesterday.newEvents, "new event")}` : ""}.`,
  ];
  return {
    subject: `${opts.test ? "[Test] " : ""}Wetin Dey admin: ${title.toLowerCase()}`,
    html: renderEmail({
      preheader: lines[0] ?? "Nothing waiting",
      title,
      paragraphs,
      cta: { label: "Open admin", url: appUrl("/admin") },
      footnote: opts.test ? "This is a test of the daily admin summary." : undefined,
    }),
    count,
  };
}

const adminDaily = {
  async resolve(event: EventRow): Promise<HandlerResult> {
    const test = event.payload.test === true;
    const onlyUserId = typeof event.payload.onlyUserId === "string" ? event.payload.onlyUserId : null;
    const win = { from: String(event.payload.from), to: String(event.payload.to) };
    const waiting = await adminWaiting();
    const days = await salesInWindow(win);
    const [created] = (await db.execute(sql`
      SELECT count(*)::int AS n FROM events
      WHERE created_at >= (${win.from}::timestamptz AT TIME ZONE 'UTC')
        AND created_at < (${win.to}::timestamptz AT TIME ZONE 'UTC')`)) as unknown as Array<{ n: number }>;
    const yesterday = {
      tickets: days.reduce((n, d) => n + d.tickets, 0),
      rsvps: days.reduce((n, d) => n + d.rsvps, 0),
      sales: days.reduce((n, d) => n + d.sales, 0),
      newEvents: created?.n ?? 0,
    };
    const email = adminSummaryEmail(waiting, yesterday, String(event.payload.label ?? ""), { test });
    // Quiet mornings stay quiet.
    if (email.count === 0 && !test) return { recipients: [] };

    let admins = await superAdmins();
    if (onlyUserId) admins = admins.filter((a) => a.userId === onlyUserId);
    return {
      recipients: admins.map((a) => ({
        userId: a.userId,
        email: a.email,
        category: "admin_actions" as const,
        inApp: null,
        emailContent: { subject: email.subject, html: email.html },
      })),
    };
  },
};

export function registerDigestHandlers(): void {
  registerHandler("digest.sales_daily", salesDaily);
  registerHandler("digest.admin_daily", adminDaily);
}

// ── Recording ───────────────────────────────────────────────────────────────

/** On the morning run: yesterday's summaries, once per Lagos date. */
export async function recordDailyDigests(executor: Db = db, now: Date = new Date()) {
  const win = yesterdayWindow(now);
  const payload = { from: win.from, to: win.to, label: win.label, date: win.date };
  const sales = await recordEvent(executor, { type: "digest.sales_daily", key: [win.date], payload });
  const admin = await recordEvent(executor, { type: "digest.admin_daily", key: [win.date], payload });
  return { date: win.date, sales: sales.recorded, admin: admin.recorded };
}

/** The admin's test button: both emails, to them only, covering today so far. */
export async function recordTestDigests(userId: string, executor: Db = db, now: Date = new Date()) {
  const from = startOfLagosDay(now);
  const payload = {
    from: from.toISOString(),
    to: now.toISOString(),
    label: `Today (${lagosLabel(from)})`,
    test: true,
    onlyUserId: userId,
  };
  const nonce = randomUUID();
  await recordEvent(executor, { type: "digest.sales_daily", key: ["test", userId, nonce], payload });
  await recordEvent(executor, { type: "digest.admin_daily", key: ["test", userId, nonce], payload });
}
