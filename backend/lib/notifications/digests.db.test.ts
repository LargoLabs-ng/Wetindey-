/**
 * The daily summary emails on a REAL database.
 * Skipped unless NOTIFICATIONS_DB_TEST_URL points at a throwaway database.
 *
 * Everything happens on a fixed date in 2031, so no other test data can land
 * in "yesterday".
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const URL = process.env.NOTIFICATIONS_DB_TEST_URL;

vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const schema = await import("../../db/schema");
  const client = postgres(process.env.NOTIFICATIONS_DB_TEST_URL ?? "postgres://unused@127.0.0.1:1/x", {
    max: 4,
    prepare: false,
  });
  return { db: drizzle(client, { schema }), __client: client };
});

const mail = { sent: [] as Array<{ to: string; subject: string; html: string }> };
vi.mock("@/lib/email-service", async (importOriginal) => {
  const real = await importOriginal<typeof import("../email-service")>();
  return {
    ...real,
    sendEmailWithResult: async (o: { to: string; subject: string; html: string }) => {
      mail.sent.push({ to: o.to, subject: o.subject, html: o.html });
      return { ok: true, status: 200, id: `re_${randomUUID()}` };
    },
  };
});

// The run happens at 08:00 Lagos on 2 Jan 2031, so "yesterday" is 1 Jan 2031.
const RUN_AT = new Date("2031-01-02T07:00:00Z");
const IN_WINDOW = "2031-01-01 12:00:00"; // 13:00 Lagos on 1 Jan (stored as UTC)
const BEFORE_WINDOW = "2030-12-31 20:00:00"; // 21:00 Lagos on 31 Dec
const AFTER_WINDOW = "2031-01-02 06:30:00"; // 07:30 Lagos on 2 Jan

describe.skipIf(!URL)("daily summary emails on a real database", () => {
  let sql: import("postgres").Sql;
  let digests: typeof import("./digests");
  let worker: typeof import("./worker");
  const P: Record<string, { id: string; email: string }> = {};
  const orgs: string[] = [];
  const ev: Record<string, string> = {};
  const tier: Record<string, string> = {};
  let uni: string;
  const adminsBefore = process.env.ADMIN_EMAILS;

  async function order(
    event: string,
    tierId: string,
    qty: number,
    subtotal: number,
    opts: { paidAt?: string | null; createdAt?: string; refunded?: number; status?: string } = {}
  ) {
    const [o] = await sql`
      INSERT INTO orders (event_id, email, phone, subtotal, fees, total, status, platform_fee_paid_by, created_at)
      VALUES (${event}, 'buyer@example.test', '0800', ${subtotal}, 0, ${subtotal + (subtotal ? 77.5 : 0)},
              ${opts.status ?? "paid"}, 'organizer', ${opts.createdAt ?? IN_WINDOW})
      RETURNING id`;
    for (let i = 0; i < qty; i += 1) {
      await sql`INSERT INTO tickets (order_id, event_id, ticket_type_id, attendee_name, attendee_email, qr_token, status)
                VALUES (${o.id}, ${event}, ${tierId}, 'Buyer', 'buyer@example.test', ${randomUUID()},
                        ${i < (opts.refunded ?? 0) ? "refunded" : "valid"})`;
    }
    await sql`INSERT INTO payments (order_id, provider, provider_reference, amount, status, paid_at)
              VALUES (${o.id}, ${subtotal ? "paystack" : "free"}, ${"WD-D-" + randomUUID()}, ${subtotal},
                      'success', ${opts.paidAt === undefined ? (subtotal ? IN_WINDOW : null) : opts.paidAt})`;
  }

  const sentTo = (who: string) => mail.sent.filter((m) => m.to === P[who].email);

  beforeAll(async () => {
    const mod = (await import("@/db")) as unknown as { __client: import("postgres").Sql };
    sql = mod.__client;
    digests = await import("./digests");
    worker = await import("./worker");
    for (const name of ["owner", "finance", "manager", "owner2", "admin"]) {
      const email = `${name}-${randomUUID()}@example.test`;
      const [u] = await sql`INSERT INTO users (email, first_name) VALUES (${email}, ${name}) RETURNING id`;
      P[name] = { id: u.id, email };
    }
    process.env.ADMIN_EMAILS = P.admin.email;
    process.env.NOTIFICATIONS_ENABLED = "true";
    process.env.NOTIFICATIONS_EMAIL_ENABLED = "true";

    for (const [owner, name] of [["owner", "Digest Org"], ["owner2", "Other Org"]] as const) {
      const [o] = await sql`INSERT INTO organizations (name, slug, owner_id) VALUES (${name}, ${"d-" + randomUUID()}, ${P[owner].id}) RETURNING id`;
      orgs.push(o.id);
      await sql`INSERT INTO organization_members (organization_id, user_id, user_email, role, status)
                VALUES (${o.id}, ${P[owner].id}, ${P[owner].email}, 'owner', 'active')`;
    }
    for (const [key, org, title] of [["A", 0, "Campus Night"], ["B", 0, "Freshers Fair"], ["C", 1, "Other Party"]] as const) {
      const [e] = await sql`INSERT INTO events (organization_id, title, slug, start_datetime, end_datetime, status, created_at)
                            VALUES (${orgs[org]}, ${title}, ${"d-" + randomUUID()}, '2031-02-01', '2031-02-02', 'published', ${BEFORE_WINDOW})
                            RETURNING id`;
      ev[key] = e.id;
      const [paid] = await sql`INSERT INTO ticket_types (event_id, name, price, quantity_total) VALUES (${e.id}, 'Regular', 1500, 100) RETURNING id`;
      const [free] = await sql`INSERT INTO ticket_types (event_id, name, price, quantity_total) VALUES (${e.id}, 'Free RSVP', 0, 100) RETURNING id`;
      tier[key] = paid.id;
      tier[`${key}free`] = free.id;
    }
    // Finance staff on A only; a manager without the money switch on A.
    await sql`INSERT INTO event_staff (event_id, user_id, user_email, role, status, can_see_finances)
              VALUES (${ev.A}, ${P.finance.id}, ${P.finance.email}, 'finance', 'active', true)`;
    await sql`INSERT INTO event_staff (event_id, user_id, user_email, role, status, can_see_finances)
              VALUES (${ev.A}, ${P.manager.id}, ${P.manager.email}, 'event_manager', 'active', false)`;

    await order(ev.A, tier.A, 2, 3000); // 2 tickets, ₦3,000
    await order(ev.A, tier.A, 2, 3000, { refunded: 1 }); // one refunded: ₦1,500 counts
    await order(ev.A, tier.Afree, 3, 0); // 3 RSVPs
    await order(ev.B, tier.B, 1, 1500, { createdAt: BEFORE_WINDOW }); // started the day before, paid in the window
    await order(ev.B, tier.B, 1, 1500, { paidAt: AFTER_WINDOW }); // paid this morning: today's
    await order(ev.C, tier.C, 4, 6000, { paidAt: BEFORE_WINDOW }); // the day before
    await order(ev.A, tier.A, 1, 1500, { status: "pending", paidAt: null }); // never paid

    const [u] = await sql`INSERT INTO universities (name, short_name, slug) VALUES ('Digest Uni', 'DU', ${"du-" + randomUUID()}) RETURNING id`;
    uni = u.id;
  });

  beforeEach(async () => {
    mail.sent.length = 0;
    await sql`DELETE FROM notification_delivery_attempts`;
    await sql`DELETE FROM notification_deliveries`;
    await sql`DELETE FROM notifications`;
    await sql`DELETE FROM notification_events`;
    await sql`DELETE FROM notification_preferences WHERE user_id IN ${sql(Object.values(P).map((p) => p.id))}`;
    await sql`DELETE FROM departments WHERE university_id = ${uni}`;
  });

  afterAll(async () => {
    process.env.ADMIN_EMAILS = adminsBefore;
    const events = Object.values(ev);
    await sql`DELETE FROM notification_deliveries`;
    await sql`DELETE FROM notification_events`;
    await sql`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE event_id IN ${sql(events)})`;
    await sql`DELETE FROM tickets WHERE event_id IN ${sql(events)}`;
    await sql`DELETE FROM orders WHERE event_id IN ${sql(events)}`;
    await sql`DELETE FROM event_staff WHERE event_id IN ${sql(events)}`;
    await sql`DELETE FROM ticket_types WHERE event_id IN ${sql(events)}`;
    await sql`DELETE FROM events WHERE id IN ${sql(events)}`;
    await sql`DELETE FROM organization_members WHERE organization_id IN ${sql(orgs)}`;
    await sql`DELETE FROM organizations WHERE id IN ${sql(orgs)}`;
    await sql`DELETE FROM departments WHERE university_id = ${uni}`;
    await sql`DELETE FROM universities WHERE id = ${uni}`;
    await sql`DELETE FROM users WHERE id IN ${sql(Object.values(P).map((p) => p.id))}`;
  });

  it("counts yesterday in Lagos time: confirmed payments, RSVPs, refunds and discounts", async () => {
    const win = digests.yesterdayWindow(RUN_AT);
    expect(win.date).toBe("2031-01-01");
    const days = (await digests.salesInWindow(win)).filter((d) => Object.values(ev).includes(d.eventId));
    expect(days).toEqual([
      { eventId: ev.A, title: "Campus Night", tickets: 3, rsvps: 3, sales: 4500 },
      { eventId: ev.B, title: "Freshers Fair", tickets: 1, rsvps: 0, sales: 1500 },
    ]);
  });

  it("sends one email per person, covering only their events, and nothing twice", async () => {
    await digests.recordDailyDigests(undefined, RUN_AT);
    await worker.runWorker({ timeBudgetMs: 10_000 });

    const owner = sentTo("owner");
    expect(owner).toHaveLength(1);
    expect(owner[0].subject).toContain("4 tickets");
    expect(owner[0].subject).toContain("₦6,000");
    expect(owner[0].html).toContain("Campus Night: 3 tickets · ₦4,500 · 3 RSVPs");
    expect(owner[0].html).toContain("Freshers Fair: 1 ticket · ₦1,500");
    expect(owner[0].html).toContain("/unsubscribe?t="); // can be turned off

    const finance = sentTo("finance");
    expect(finance).toHaveLength(1);
    expect(finance[0].html).toContain("Campus Night");
    expect(finance[0].html).not.toContain("Freshers Fair");

    expect(sentTo("manager")).toHaveLength(0); // no money switch
    expect(sentTo("owner2")).toHaveLength(0); // nothing sold yesterday

    // The backup run later the same morning adds nothing.
    const again = await digests.recordDailyDigests(undefined, RUN_AT);
    expect(again).toMatchObject({ sales: false, admin: false });
    await worker.runWorker({ timeBudgetMs: 10_000 });
    expect(sentTo("owner")).toHaveLength(1);
    // No bell for a summary: each sale already rang it.
    const inbox = await sql`SELECT 1 FROM notifications WHERE user_id = ${P.owner.id}`;
    expect(inbox).toHaveLength(0);
  });

  it("respects someone who switched the daily summary off", async () => {
    await sql`INSERT INTO notification_preferences (user_id, category, channel, enabled) VALUES (${P.owner.id}, 'sales', 'email', false)`;
    await digests.recordDailyDigests(undefined, RUN_AT);
    await worker.runWorker({ timeBudgetMs: 10_000 });
    expect(sentTo("owner")).toHaveLength(0);
    expect(sentTo("finance")).toHaveLength(1);
  });

  it("emails admins only when something is waiting on them", async () => {
    const waiting = await digests.adminWaiting();
    const nothingElseWaiting = Object.values(waiting).every((n) => n === 0);
    await digests.recordDailyDigests(undefined, RUN_AT);
    await worker.runWorker({ timeBudgetMs: 10_000 });
    // This database may hold other test data; only assert quiet when it's quiet.
    if (nothingElseWaiting) expect(sentTo("admin")).toHaveLength(0);

    await sql`DELETE FROM notification_deliveries`;
    await sql`DELETE FROM notification_events`;
    mail.sent.length = 0;
    await sql`INSERT INTO departments (university_id, name, slug, status) VALUES (${uni}, 'Marine Biology', ${"mb-" + randomUUID()}, 'pending')`;
    await digests.recordDailyDigests(undefined, RUN_AT);
    await worker.runWorker({ timeBudgetMs: 10_000 });
    const admin = sentTo("admin");
    expect(admin).toHaveLength(1);
    expect(admin[0].html).toMatch(/\d+ departments? waiting for approval/);
    expect(admin[0].html).toContain("4 tickets");
  });

  it("the test button emails only the admin who pressed it, even on a quiet day", async () => {
    await digests.recordTestDigests(P.admin.id);
    await worker.runWorker({ timeBudgetMs: 10_000 });
    expect(mail.sent.map((m) => m.to)).toEqual([P.admin.email, P.admin.email]);
    expect(mail.sent.every((m) => m.subject.startsWith("[Test]"))).toBe(true);
    expect(mail.sent.some((m) => m.html.includes("Nothing sold in this period."))).toBe(true);
  });
});

describe("summary email wording", () => {
  it("adds up the totals, lists events and cuts long lists short", async () => {
    vi.resetModules();
    const { salesSummaryEmail, adminSummaryEmail } = await import("./digests");
    const days = Array.from({ length: 12 }, (_, i) => ({
      eventId: String(i),
      title: `Event ${i + 1}`,
      tickets: 1,
      rsvps: i === 0 ? 2 : 0,
      sales: 1000,
    }));
    const email = salesSummaryEmail(days, "Thu 1 Jan");
    expect(email.subject).toBe("Yesterday (Thu 1 Jan): 12 tickets · ₦12,000 · 2 RSVPs");
    expect(email.html).toContain("Event 10: 1 ticket · ₦1,000");
    expect(email.html).not.toContain("Event 11:");
    expect(email.html).toContain("And 2 more events.");

    const rsvpOnly = salesSummaryEmail([{ eventId: "x", title: "Free Fest", tickets: 0, rsvps: 5, sales: 0 }], "Thu 1 Jan");
    expect(rsvpOnly.subject).toBe("Yesterday (Thu 1 Jan): 5 RSVPs");

    const quiet = adminSummaryEmail(
      { payouts: 0, paymentReviews: 0, departments: 0, reports: 0, failedNotifications: 0 },
      { tickets: 0, rsvps: 0, sales: 0, newEvents: 0 },
      "Thu 1 Jan"
    );
    expect(quiet.count).toBe(0);
    const busy = adminSummaryEmail(
      { payouts: 2, paymentReviews: 1, departments: 0, reports: 0, failedNotifications: 0 },
      { tickets: 3, rsvps: 0, sales: 4500, newEvents: 1 },
      "Thu 1 Jan"
    );
    expect(busy.count).toBe(2);
    expect(busy.subject).toBe("Wetin Dey admin: 2 things need you today");
    expect(busy.html).toContain("2 payout requests");
    expect(busy.html).toContain("1 payment needs review");
    expect(busy.html).toContain("Thu 1 Jan: 3 tickets · ₦4,500 · 1 new event.");
  });
});
