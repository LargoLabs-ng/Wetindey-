/**
 * The notification engine against a REAL Postgres database.
 *
 * Skipped unless NOTIFICATIONS_DB_TEST_URL points at a throwaway database
 * with the schema and migration 0025 applied. NEVER point it at production
 * or shared staging data: it deletes every notification row before each test.
 *
 * What only a real database can prove: two workers really never take the
 * same row, expired claims really are taken over, the attempt limit really
 * holds, and repeating any step really creates nothing new.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const URL = process.env.NOTIFICATIONS_DB_TEST_URL;

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const schema = await import("../../db/schema");
  const client = postgres(process.env.NOTIFICATIONS_DB_TEST_URL ?? "postgres://unused@127.0.0.1:1/x", {
    max: 6,
    prepare: false,
  });
  return { db: drizzle(client, { schema }), __client: client };
});

type Outcome = { ok: boolean; status?: number; error?: string; id?: string };
const mail = {
  sent: [] as Array<{
    to: string;
    subject: string;
    idempotencyKey?: string;
    html?: string;
    headers?: Record<string, string>;
  }>,
  next: [] as Outcome[],
  delayMs: 0,
};
vi.mock("@/lib/email-service", async (importOriginal) => {
  const real = await importOriginal<typeof import("../email-service")>();
  return {
    ...real,
    sendEmailWithResult: async (o: {
      to: string;
      subject: string;
      idempotencyKey?: string;
      html?: string;
      headers?: Record<string, string>;
    }) => {
      if (mail.delayMs) await new Promise((r) => setTimeout(r, mail.delayMs));
      mail.sent.push({ to: o.to, subject: o.subject, idempotencyKey: o.idempotencyKey, html: o.html, headers: o.headers });
      return mail.next.shift() ?? { ok: true, status: 200, id: `re_${randomUUID()}` };
    },
  };
});

describe.skipIf(!URL)("notification engine on a real database", () => {
  let sql: import("postgres").Sql;
  let db: typeof import("@/db").db;
  let outbox: typeof import("./outbox");
  let worker: typeof import("./worker");
  let registry: typeof import("./registry");
  let maintenance: typeof import("./maintenance");
  let recipients: typeof import("./recipients");
  let userA: { id: string; email: string };
  let userB: { id: string; email: string };

  /** A handler that sends one in-app + one email to each listed user. */
  function registerSimple(type: string, users: Array<{ id: string; email: string }>, opts: {
    category?: import("./preferences").Category;
    essential?: boolean;
    pages?: number;
  } = {}) {
    registry.registerHandler(type, {
      async resolve(_event, cursor) {
        const page = cursor ? Number(cursor) : 0;
        const last = (opts.pages ?? 1) - 1;
        return {
          recipients: users.map((u) => ({
            userId: u.id,
            email: u.email,
            category: opts.category ?? "sales",
            essential: opts.essential,
            inApp: { title: `Hello ${page}`, body: "Body", url: "/dashboard" },
            emailContent: { subject: `Subject ${page}`, html: "<p>Hi</p><!--wd:unsubscribe-->" },
          })),
          nextCursor: page < last ? String(page + 1) : null,
        };
      },
    });
  }

  async function record(type: string, key = randomUUID()) {
    return outbox.recordEvent(db, { type, key: [key], payload: { id: key } });
  }

  /** Make every pending row due right now (skips the waiting between retries). */
  async function makeDue() {
    await sql`UPDATE notification_events SET next_attempt_at = now() - interval '1 second' WHERE status = 'pending'`;
    await sql`UPDATE notification_deliveries SET next_attempt_at = now() - interval '1 second' WHERE status = 'pending'`;
  }

  beforeAll(async () => {
    process.env.NOTIFICATIONS_ENABLED = "true";
    process.env.NOTIFICATIONS_EMAIL_ENABLED = "true";
    const mod = (await import("@/db")) as unknown as { __client: import("postgres").Sql; db: typeof db };
    sql = mod.__client;
    db = mod.db;
    outbox = await import("./outbox");
    worker = await import("./worker");
    registry = await import("./registry");
    maintenance = await import("./maintenance");
    recipients = await import("./recipients");
    const mk = async (name: string) => {
      const email = `${name}-${randomUUID()}@example.test`;
      const [u] = await sql`INSERT INTO users (email, first_name, last_name) VALUES (${email}, ${name}, 'Test') RETURNING id`;
      return { id: u.id as string, email };
    };
    userA = await mk("ada");
    userB = await mk("bayo");
  });

  beforeEach(async () => {
    await sql`DELETE FROM notification_delivery_attempts`;
    await sql`DELETE FROM notification_deliveries`;
    await sql`DELETE FROM notifications`;
    await sql`DELETE FROM notification_events`;
    await sql`DELETE FROM notification_preferences`;
    registry.clearHandlers();
    mail.sent.length = 0;
    mail.next.length = 0;
    mail.delayMs = 0;
    process.env.NOTIFICATIONS_EMAIL_ENABLED = "true";
    delete process.env.NOTIFICATIONS_EMAIL_DAILY_BUDGET;
  });

  afterAll(async () => {
    await sql`DELETE FROM users WHERE id IN (${userA.id}, ${userB.id})`;
  });

  it("records a happening once, however often it is reported", async () => {
    const key = randomUUID();
    const first = await outbox.recordEvent(db, { type: "test.once", key: [key] });
    const second = await outbox.recordEvent(db, { type: "test.once", key: [key] });
    expect(first.recorded).toBe(true);
    expect(second.recorded).toBe(false);
    const rows = await sql`SELECT count(*)::int AS n FROM notification_events WHERE dedupe_key = ${`test.once:${key}`}`;
    expect(rows[0].n).toBe(1);
  });

  it("saves nothing when the surrounding transaction rolls back", async () => {
    const key = randomUUID();
    await expect(
      db.transaction(async (tx) => {
        await outbox.recordEvent(tx, { type: "test.rollback", key: [key] });
        throw new Error("the business change failed");
      })
    ).rejects.toThrow("the business change failed");
    const rows = await sql`SELECT 1 FROM notification_events WHERE dedupe_key = ${`test.rollback:${key}`}`;
    expect(rows).toHaveLength(0);
  });

  it("turns an event into one inbox row and one sent email, and a second run adds nothing", async () => {
    registerSimple("test.simple", [userA]);
    await record("test.simple");
    const summary = await worker.runWorker({ timeBudgetMs: 10_000 });
    expect(summary.events).toMatchObject({ claimed: 1, done: 1, failed: 0 });
    expect(summary.deliveries).toMatchObject({ claimed: 1, sent: 1 });

    const [delivery] = await sql`SELECT * FROM notification_deliveries`;
    expect(delivery.status).toBe("sent");
    expect(delivery.attempts).toBe(1);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].idempotencyKey).toBe(delivery.id); // Resend drops repeats
    const attempts = await sql`SELECT * FROM notification_delivery_attempts WHERE delivery_id = ${delivery.id}`;
    expect(attempts).toHaveLength(1);
    expect(attempts[0].outcome).toBe("sent");
    const inbox = await sql`SELECT * FROM notifications WHERE user_id = ${userA.id}`;
    expect(inbox).toHaveLength(1);
    expect(delivery.notification_id).toBe(inbox[0].id);

    const again = await worker.runWorker({ timeBudgetMs: 10_000 });
    expect(again.events.claimed).toBe(0);
    expect(again.deliveries.claimed).toBe(0);
    expect(mail.sent).toHaveLength(1);
  });

  it("two workers at once never send the same delivery twice", async () => {
    const people = [userA, userB];
    registerSimple("test.parallel", people);
    for (let i = 0; i < 15; i += 1) await record("test.parallel");
    mail.delayMs = 5;
    const [one, two] = await Promise.all([
      worker.runWorker({ timeBudgetMs: 15_000 }),
      worker.runWorker({ timeBudgetMs: 15_000 }),
    ]);
    expect(one.events.claimed + two.events.claimed).toBe(15);
    expect(one.deliveries.sent + two.deliveries.sent).toBe(30);
    const keys = mail.sent.map((m) => m.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM notification_deliveries WHERE status = 'sent' AND attempts = 1`;
    expect(n).toBe(30);
  });

  it("adds an unsubscribe link and headers only to emails that can be turned off", async () => {
    process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-secret-for-unsubscribe-links";
    registerSimple("test.unsub.sales", [userA], { category: "sales" });
    registerSimple("test.unsub.payouts", [userA], { category: "payouts" });
    registerSimple("test.unsub.urgent", [userB], { category: "sales", essential: true });
    await record("test.unsub.sales");
    await record("test.unsub.payouts");
    await record("test.unsub.urgent");
    await worker.runWorker({ timeBudgetMs: 10_000 });
    expect(mail.sent).toHaveLength(3);

    const byKind = async (type: string) => {
      const [d] = await sql`SELECT d.id FROM notification_deliveries d JOIN notification_events e ON e.id = d.event_id WHERE e.type = ${type}`;
      return mail.sent.find((m) => m.idempotencyKey === d.id)!;
    };
    const sales = await byKind("test.unsub.sales");
    expect(sales.html).toContain("/unsubscribe?t=");
    expect(sales.html).not.toContain("<!--wd:unsubscribe-->");
    expect(sales.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(sales.headers?.["List-Unsubscribe"]).toMatch(/^<.+\/api\/notifications\/unsubscribe\?t=.+>$/);

    for (const kind of ["test.unsub.payouts", "test.unsub.urgent"]) {
      const m = await byKind(kind);
      expect(m.html).not.toContain("unsubscribe?t=");
      expect(m.html).not.toContain("<!--wd:unsubscribe-->");
      expect(m.headers).toBeUndefined();
    }
  });

  it("retries a temporary failure on the schedule and stops after the 5th attempt", async () => {
    registerSimple("test.retry", [userA]);
    await record("test.retry");
    mail.next.push(...Array.from({ length: 5 }, () => ({ ok: false, status: 503, error: "Resend 503" })));

    const waits: number[] = [];
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await worker.runWorker({ timeBudgetMs: 10_000 });
      const [d] = await sql`
        SELECT status, attempts, extract(epoch FROM next_attempt_at - now())::int AS wait
        FROM notification_deliveries`;
      expect(d.attempts).toBe(attempt);
      if (attempt < 5) {
        expect(d.status).toBe("pending");
        waits.push(d.wait);
        await makeDue();
      } else {
        expect(d.status).toBe("failed");
      }
    }
    // 1 min, 10 min, 1 h, 6 h, each within ±10% (and a second of rounding).
    const expected = [60, 600, 3600, 21600];
    waits.forEach((w, i) => {
      expect(w).toBeGreaterThanOrEqual(Math.floor(expected[i] * 0.9) - 2);
      expect(w).toBeLessThanOrEqual(Math.ceil(expected[i] * 1.1) + 1);
    });

    await makeDue();
    const sixth = await worker.runWorker({ timeBudgetMs: 10_000 });
    expect(sixth.deliveries.claimed).toBe(0);
    const attempts = await sql`SELECT attempt_number, outcome FROM notification_delivery_attempts ORDER BY attempt_number`;
    expect(attempts.map((a) => a.attempt_number)).toEqual([1, 2, 3, 4, 5]);
    expect(attempts.every((a) => a.outcome === "temporary_failure")).toBe(true);
    expect(mail.sent).toHaveLength(5);
  });

  it("the database refuses a 6th attempt outright", async () => {
    registerSimple("test.check", [userA]);
    await record("test.check");
    await worker.runWorker({ timeBudgetMs: 10_000 });
    await expect(sql`UPDATE notification_deliveries SET attempts = 6`).rejects.toThrow(/attempts_check/);
  });

  it("gives up straight away on a permanent failure", async () => {
    registerSimple("test.permanent", [userA]);
    await record("test.permanent");
    mail.next.push({ ok: false, status: 422, error: "Resend 422: invalid address" });
    await worker.runWorker({ timeBudgetMs: 10_000 });
    const [d] = await sql`SELECT status, attempts, last_error FROM notification_deliveries`;
    expect(d).toMatchObject({ status: "failed", attempts: 1 });
    expect(d.last_error).toMatch(/422/);
  });

  it("takes over a delivery whose run died, and counts the cut-off attempt", async () => {
    registerSimple("test.takeover", [userA]);
    await record("test.takeover");
    mail.next.push({ ok: false, status: 503, error: "down" });
    await worker.runWorker({ timeBudgetMs: 10_000 }); // attempt 1 fails temporarily
    const [d0] = await sql`SELECT id FROM notification_deliveries`;
    // Simulate a run that claimed attempt 2 and then died mid-send.
    await sql`UPDATE notification_deliveries
              SET status = 'processing', attempts = 2, claimed_by = 'dead-run',
                  locked_until = now() - interval '1 second'
              WHERE id = ${d0.id}`;
    await sql`INSERT INTO notification_delivery_attempts (delivery_id, attempt_number, started_at)
              VALUES (${d0.id}, 2, now() - interval '5 minutes')`;

    await worker.runWorker({ timeBudgetMs: 10_000 });
    const [d] = await sql`SELECT status, attempts, claimed_by FROM notification_deliveries`;
    expect(d.status).toBe("sent");
    expect(d.attempts).toBe(3);
    const attempts = await sql`SELECT attempt_number, outcome FROM notification_delivery_attempts ORDER BY attempt_number`;
    expect(attempts.map((a) => [a.attempt_number, a.outcome])).toEqual([
      [1, "temporary_failure"],
      [2, "abandoned"],
      [3, "sent"],
    ]);

    // The dead run waking up late can't overwrite the real result.
    const late = await sql`UPDATE notification_deliveries SET status = 'failed'
                           WHERE id = ${d0.id} AND claimed_by = 'dead-run' RETURNING id`;
    expect(late).toHaveLength(0);
  });

  it("fails a claim that expired on its last attempt", async () => {
    registerSimple("test.exhausted", [userA]);
    await record("test.exhausted");
    mail.next.push({ ok: false, status: 503, error: "down" });
    await worker.runWorker({ timeBudgetMs: 10_000 });
    await sql`UPDATE notification_deliveries
              SET status = 'processing', attempts = 5, claimed_by = 'dead-run',
                  locked_until = now() - interval '1 second'`;
    const summary = await worker.runWorker({ timeBudgetMs: 10_000 });
    expect(summary.exhaustedClaims.deliveries).toBe(1);
    const [d] = await sql`SELECT status FROM notification_deliveries`;
    expect(d.status).toBe("failed");
  });

  it("with email switched off, records the bell entry and skips the email", async () => {
    process.env.NOTIFICATIONS_EMAIL_ENABLED = "false";
    registerSimple("test.emailoff", [userA]);
    await record("test.emailoff");
    await worker.runWorker({ timeBudgetMs: 10_000 });
    const [d] = await sql`SELECT status, last_error FROM notification_deliveries`;
    expect(d.status).toBe("skipped");
    expect(mail.sent).toHaveLength(0);
    const inbox = await sql`SELECT 1 FROM notifications`;
    expect(inbox).toHaveLength(1);
  });

  it("respects someone switching a category's email off, but not a locked one", async () => {
    await sql`INSERT INTO notification_preferences (user_id, category, channel, enabled)
              VALUES (${userA.id}, 'sales', 'email', false), (${userA.id}, 'payouts', 'email', false)`;
    registerSimple("test.muted", [userA], { category: "sales" });
    registerSimple("test.locked", [userA], { category: "payouts" });
    await record("test.muted");
    await record("test.locked");
    await worker.runWorker({ timeBudgetMs: 10_000 });
    const rows = await sql`SELECT e.type, d.status FROM notification_deliveries d JOIN notification_events e ON e.id = d.event_id`;
    expect(rows.map((r) => r.type)).toEqual(["test.locked"]); // sales email muted, payouts locked on
    expect(mail.sent).toHaveLength(1);
  });

  it("holds non-essential emails once the daily budget is used, but never essential ones", async () => {
    process.env.NOTIFICATIONS_EMAIL_DAILY_BUDGET = "1";
    registerSimple("test.summary", [userA, userB], { category: "sales" });
    registerSimple("test.ticket", [userA], { category: "tickets", essential: true });
    await record("test.summary");
    await record("test.ticket");
    await worker.runWorker({ timeBudgetMs: 10_000 });
    const rows = await sql`SELECT essential, status FROM notification_deliveries ORDER BY essential DESC, status`;
    // essential sent; budget 1 was already used by it, so both summaries wait
    expect(rows.filter((r) => r.essential).map((r) => r.status)).toEqual(["sent"]);
    expect(rows.filter((r) => !r.essential).map((r) => r.status)).toEqual(["pending", "pending"]);

    process.env.NOTIFICATIONS_EMAIL_DAILY_BUDGET = "2";
    await worker.runWorker({ timeBudgetMs: 10_000 });
    const after = await sql`SELECT status FROM notification_deliveries WHERE NOT essential ORDER BY status`;
    expect(after.map((r) => r.status)).toEqual(["pending", "sent"]);
  });

  it("works through a big audience page by page without using up attempts", async () => {
    registerSimple("test.pages", [userA], { pages: 3 });
    await record("test.pages");
    for (let run = 0; run < 3; run += 1) await worker.runWorker({ timeBudgetMs: 10_000 });
    const [e] = await sql`SELECT status, attempts, fanout_cursor FROM notification_events`;
    expect(e.status).toBe("done");
    expect(e.attempts).toBe(1);
    expect(e.fanout_cursor).toBeNull();
    // Each page used a different title but the same person: still one bell entry.
    const inbox = await sql`SELECT title FROM notifications`;
    expect(inbox).toHaveLength(1);
  });

  it("fails an event with no handler instead of retrying forever", async () => {
    await record("test.nobody-handles-this");
    const summary = await worker.runWorker({ timeBudgetMs: 10_000 });
    expect(summary.events.failed).toBe(1);
    const [e] = await sql`SELECT status, last_error FROM notification_events`;
    expect(e.status).toBe("failed");
    expect(e.last_error).toMatch(/No handler/);
  });

  it("retries an event whose fan-out throws, then stops after 5 attempts", async () => {
    registry.registerHandler("test.broken", {
      async resolve() {
        throw new Error("database blip");
      },
    });
    await record("test.broken");
    for (let i = 0; i < 6; i += 1) {
      await worker.runWorker({ timeBudgetMs: 10_000 });
      await makeDue();
    }
    const [e] = await sql`SELECT status, attempts, last_error FROM notification_events`;
    expect(e).toMatchObject({ status: "failed", attempts: 5 });
    expect(e.last_error).toMatch(/database blip/);
  });

  it("does not process a scheduled event before its time", async () => {
    registerSimple("test.later", [userA]);
    await outbox.recordEvent(db, {
      type: "test.later",
      key: [randomUUID()],
      availableAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const summary = await worker.runWorker({ timeBudgetMs: 10_000 });
    expect(summary.events.claimed).toBe(0);
  });

  it("finds admins by permission, including ADMIN_EMAILS", async () => {
    const before = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = userB.email.toUpperCase();
    // Ada is a Support Admin: she can view tickets but can't manage payouts.
    await sql`INSERT INTO platform_admin_assignments (user_id, role_id) VALUES (${userA.id}, 'support_admin') ON CONFLICT DO NOTHING`;
    try {
      const payouts = await recipients.adminsWithPermission("payouts.manage");
      expect(payouts.map((p) => p.userId)).toEqual([userB.id]); // only the allowlisted super admin
      const tickets = await recipients.adminsWithPermission("tickets.view");
      expect(tickets.map((p) => p.userId).sort()).toEqual([userA.id, userB.id].sort());

      // Suspended admins stop receiving straight away.
      await sql`UPDATE platform_admin_assignments SET status = 'suspended' WHERE user_id = ${userA.id}`;
      const afterSuspend = await recipients.adminsWithPermission("tickets.view");
      expect(afterSuspend.map((p) => p.userId)).toEqual([userB.id]);
    } finally {
      process.env.ADMIN_EMAILS = before;
      await sql`DELETE FROM platform_admin_assignments WHERE user_id = ${userA.id}`;
    }
  });

  it("cleans up old read notifications and old logs, and keeps everything else", async () => {
    registerSimple("test.cleanup", [userA, userB]);
    await record("test.cleanup");
    await worker.runWorker({ timeBudgetMs: 10_000 });
    await sql`UPDATE notifications SET read_at = now() - interval '200 days' WHERE user_id = ${userA.id}`;
    await sql`UPDATE notification_delivery_attempts SET started_at = now() - interval '100 days'`;
    const summary = await maintenance.cleanUpOldNotifications();
    expect(summary.readNotifications).toBe(1);
    expect(summary.attempts).toBe(2);
    const left = await sql`SELECT user_id FROM notifications`;
    expect(left.map((r) => r.user_id)).toEqual([userB.id]); // unread kept
  });
});
