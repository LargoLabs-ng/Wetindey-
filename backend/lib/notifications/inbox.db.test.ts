/**
 * The in-app inbox and the admin retry, on a REAL database.
 * Skipped unless NOTIFICATIONS_DB_TEST_URL points at a throwaway database.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { maskEmail } from "./admin-health";

const URL = process.env.NOTIFICATIONS_DB_TEST_URL;

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

describe("maskEmail", () => {
  it("keeps enough to recognise, not to harvest", () => {
    expect(maskEmail("kisha.of.web3@gmail.com")).toBe("ki***@gmail.com");
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail("broken")).toBe("***");
  });
});

describe.skipIf(!URL)("the inbox on a real database", () => {
  let sql: import("postgres").Sql;
  let inbox: typeof import("./inbox");
  let adminHealth: typeof import("./admin-health");
  let ada: string;
  let bayo: string;

  async function add(userId: string, n: number, opts: { read?: boolean } = {}) {
    const ids: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const [row] = await sql`
        INSERT INTO notifications (user_id, type, category, title, dedupe_key, read_at, created_at)
        VALUES (${userId}, 'test.inbox', 'sales', ${`Title ${i}`}, ${`inbox-test:${randomUUID()}`},
                ${opts.read ? sql`now()` : null}, now() - make_interval(secs => ${i}))
        RETURNING id`;
      ids.push(row.id);
    }
    return ids;
  }

  beforeAll(async () => {
    const mod = (await import("@/db")) as unknown as { __client: import("postgres").Sql };
    sql = mod.__client;
    inbox = await import("./inbox");
    adminHealth = await import("./admin-health");
    const [a] = await sql`INSERT INTO users (email) VALUES (${`ada-${randomUUID()}@example.test`}) RETURNING id`;
    const [b] = await sql`INSERT INTO users (email) VALUES (${`bayo-${randomUUID()}@example.test`}) RETURNING id`;
    ada = a.id;
    bayo = b.id;
  });

  beforeEach(async () => {
    await sql`DELETE FROM notifications WHERE user_id IN (${ada}, ${bayo})`;
  });

  afterAll(async () => {
    await sql`DELETE FROM users WHERE id IN (${ada}, ${bayo})`;
  });

  it("lists only your own notifications, newest first, with an unread count", async () => {
    await add(ada, 3);
    await add(bayo, 2);
    const page = await inbox.listInbox(ada);
    expect(page.items.map((i) => i.title)).toEqual(["Title 0", "Title 1", "Title 2"]);
    expect(page.nextCursor).toBeNull();
    expect(await inbox.unreadCount(ada)).toBe(3);
    expect(await inbox.unreadCount(bayo)).toBe(2);
  });

  it("pages through a long inbox without repeats or gaps", async () => {
    await add(ada, 45);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await inbox.listInbox(ada, { cursor, limit: 20 });
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(45);
    expect(new Set(seen).size).toBe(45);
  });

  it("marks read only your own notifications, even when given someone else's ids", async () => {
    const mine = await add(ada, 2);
    const theirs = await add(bayo, 2);
    const changed = await inbox.markRead(ada, [...mine, ...theirs]);
    expect(changed).toBe(2);
    expect(await inbox.unreadCount(ada)).toBe(0);
    expect(await inbox.unreadCount(bayo)).toBe(2); // untouched
  });

  it("ignores junk ids instead of failing", async () => {
    expect(await inbox.markRead(ada, ["not-a-uuid", "'; DROP TABLE users; --"])).toBe(0);
  });

  it("marks all read, for you only", async () => {
    await add(ada, 4);
    await add(bayo, 1);
    expect(await inbox.markAllRead(ada)).toBe(4);
    expect(await inbox.unreadCount(ada)).toBe(0);
    expect(await inbox.unreadCount(bayo)).toBe(1);
  });

  it("an admin retry gives a failed delivery a fresh 5 attempts, and leaves others alone", async () => {
    const [failed] = await sql`
      INSERT INTO notification_deliveries (email, channel, category, dedupe_key, status, attempts, last_error)
      VALUES ('x@example.test', 'email', 'sales', ${`retry-${randomUUID()}`}, 'failed', 5, 'Resend 503') RETURNING id`;
    const [sent] = await sql`
      INSERT INTO notification_deliveries (email, channel, category, dedupe_key, status, attempts)
      VALUES ('x@example.test', 'email', 'sales', ${`retry-${randomUUID()}`}, 'sent', 1) RETURNING id`;
    expect(await adminHealth.retryFailed("delivery", failed.id)).toBe(true);
    expect(await adminHealth.retryFailed("delivery", sent.id)).toBe(false);
    const [after] = await sql`SELECT status, attempts, last_error FROM notification_deliveries WHERE id = ${failed.id}`;
    expect(after).toMatchObject({ status: "pending", attempts: 0, last_error: "Retried by an admin." });
    await sql`DELETE FROM notification_deliveries WHERE id IN (${failed.id}, ${sent.id})`;
  });
});
