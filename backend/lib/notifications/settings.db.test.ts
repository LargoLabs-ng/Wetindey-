/**
 * The notification settings page rules, on a REAL database.
 * Skipped unless NOTIFICATIONS_DB_TEST_URL points at a throwaway database.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const URL = process.env.NOTIFICATIONS_DB_TEST_URL;

// Sessions aren't used here; this stands in for the login library, which can't load in tests.
vi.mock("@/auth", () => ({ auth: async () => null }));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const schema = await import("../../db/schema");
  const client = postgres(process.env.NOTIFICATIONS_DB_TEST_URL ?? "postgres://unused@127.0.0.1:1/x", {
    max: 2,
    prepare: false,
  });
  return { db: drizzle(client, { schema }), __client: client };
});

describe.skipIf(!URL)("notification settings on a real database", () => {
  let sql: import("postgres").Sql;
  let settings: typeof import("./settings");
  let prefs: typeof import("./preferences");
  const P: Record<string, { id: string; email: string }> = {};
  let org: string, event: string;
  const adminsBefore = process.env.ADMIN_EMAILS;

  const sectionIds = async (who: string) => (await settings.settingsFor(P[who].id, P[who].email)).map((s) => s.id);

  beforeAll(async () => {
    const mod = (await import("@/db")) as unknown as { __client: import("postgres").Sql };
    sql = mod.__client;
    settings = await import("./settings");
    prefs = await import("./preferences");
    for (const name of ["owner", "editor", "gate", "attendee", "finance", "listed"]) {
      const email = `${name}-${randomUUID()}@example.test`;
      const [u] = await sql`INSERT INTO users (email) VALUES (${email}) RETURNING id`;
      P[name] = { id: u.id, email };
    }
    process.env.ADMIN_EMAILS = P.listed.email;
    const [o] = await sql`INSERT INTO organizations (name, slug, owner_id) VALUES ('Settings Org', ${"s-" + randomUUID()}, ${P.owner.id}) RETURNING id`;
    org = o.id;
    await sql`INSERT INTO organization_members (organization_id, user_id, user_email, role, status) VALUES (${org}, ${P.owner.id}, ${P.owner.email}, 'owner', 'active')`;
    const [e] = await sql`INSERT INTO events (organization_id, title, slug, start_datetime, end_datetime, status)
                          VALUES (${org}, 'Settings Night', ${"s-" + randomUUID()}, now() + interval '7 days', now() + interval '8 days', 'published')
                          RETURNING id`;
    event = e.id;
    await sql`INSERT INTO event_staff (event_id, user_id, user_email, role, status) VALUES (${event}, ${P.editor.id}, ${P.editor.email}, 'event_manager', 'active')`;
    await sql`INSERT INTO event_staff (event_id, user_id, user_email, role, status) VALUES (${event}, ${P.gate.id}, ${P.gate.email}, 'gate_staff', 'active')`;
    await sql`INSERT INTO platform_admin_assignments (user_id, role_id, status) VALUES (${P.finance.id}, 'finance_admin', 'active')`;
  });

  afterAll(async () => {
    process.env.ADMIN_EMAILS = adminsBefore;
    const ids = Object.values(P).map((p) => p.id);
    await sql`DELETE FROM notification_preferences WHERE user_id IN ${sql(ids)}`;
    await sql`DELETE FROM platform_admin_assignments WHERE user_id IN ${sql(ids)}`;
    await sql`DELETE FROM event_staff WHERE event_id = ${event}`;
    await sql`DELETE FROM events WHERE id = ${event}`;
    await sql`DELETE FROM organization_members WHERE organization_id = ${org}`;
    await sql`DELETE FROM organizations WHERE id = ${org}`;
    await sql`DELETE FROM users WHERE id IN ${sql(ids)}`;
  });

  it("shows each person only the sections that apply to them", async () => {
    expect(await sectionIds("owner")).toEqual(["organiser"]);
    expect(await sectionIds("editor")).toEqual(["organiser"]);
    expect(await sectionIds("gate")).toEqual([]); // door staff only scan tickets
    expect(await sectionIds("attendee")).toEqual([]);
    expect(await sectionIds("finance")).toEqual(["admin"]);
    expect(await sectionIds("listed")).toEqual(["admin"]);
  });

  it("shows only in-app and email, with locked switches marked and explained", async () => {
    const [section] = await settings.settingsFor(P.owner.id, P.owner.email);
    const payouts = section.topics.find((t) => t.category === "payouts")!;
    expect(payouts.switches.map((s) => s.channel)).toEqual(["in_app", "email"]);
    expect(payouts.switches.every((s) => s.on && s.locked && s.lockedReason)).toBe(true);
    const sales = section.topics.find((t) => t.category === "sales")!;
    expect(sales.switches).toEqual([
      { channel: "in_app", label: "In the app", on: true, locked: false, lockedReason: null },
      { channel: "email", label: "Daily summary email", on: true, locked: false, lockedReason: null },
    ]);
  });

  it("saves a change and shows it next time", async () => {
    expect(await settings.canChange(P.owner.id, P.owner.email, "sales", "email")).toBe(true);
    await prefs.setPreference(P.owner.id, "sales", "email", false);
    const [section] = await settings.settingsFor(P.owner.id, P.owner.email);
    expect(section.topics.find((t) => t.category === "sales")!.switches[1].on).toBe(false);
  });

  it("refuses locked switches, push, and topics that aren't on the person's page", async () => {
    expect(await settings.canChange(P.owner.id, P.owner.email, "payouts", "email")).toBe(false);
    expect(await settings.canChange(P.owner.id, P.owner.email, "sales", "push")).toBe(false);
    expect(await settings.canChange(P.owner.id, P.owner.email, "admin_actions", "email")).toBe(false);
    expect(await settings.canChange(P.attendee.id, P.attendee.email, "sales", "email")).toBe(false);
    expect(await settings.canChange(P.finance.id, P.finance.email, "admin_actions", "email")).toBe(true);
  });
});
