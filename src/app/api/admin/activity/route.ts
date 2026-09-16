import { NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { events, orders, organizations, users, departments } from "@/db/schema";
import { getSessionUserId, isPlatformAdmin } from "@/lib/authz";

/**
 * GET /api/admin/activity
 *
 * What has actually happened, newest first, and what is waiting on someone.
 *
 * The dashboard used to show four totals and nothing else, which told you the
 * size of the platform but never what was going on inside it. Names and times
 * are what make it legible: "Ada bought 2 tickets to Freshers Night" says more
 * than "Total Attendees: 2".
 */
type Item = {
  kind: "sale" | "event" | "signup";
  at: string;
  title: string;
  detail: string;
};

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isPlatformAdmin())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [recentOrders, recentEvents, recentUsers] = await Promise.all([
    db.query.orders.findMany({
      where: eq(orders.status, "paid"),
      orderBy: [desc(orders.createdAt)],
      limit: 8,
      with: { event: true, tickets: true },
    }),
    db
      .select()
      .from(events)
      .orderBy(desc(events.createdAt))
      .limit(8),
    db
      .select({
        id: users.id,
        name: users.name,
        createdAt: users.createdAt,
        departmentId: users.departmentId,
      })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(8),
  ]);

  const orgIds = [...new Set(recentEvents.map((e) => e.organizationId))];
  const orgs = orgIds.length
    ? await db.select().from(organizations).where(inArray(organizations.id, orgIds))
    : [];
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));

  const deptIds = [
    ...new Set(recentUsers.map((u) => u.departmentId).filter(Boolean) as string[]),
  ];
  const depts = deptIds.length
    ? await db.select().from(departments).where(inArray(departments.id, deptIds))
    : [];
  const deptName = new Map(depts.map((d) => [d.id, d.name]));

  const items: Item[] = [
    ...recentOrders.map((o) => ({
      kind: "sale" as const,
      at: new Date(o.createdAt).toISOString(),
      title: `${o.tickets.length} ${o.tickets.length === 1 ? "ticket" : "tickets"} · ${
        o.event?.title ?? "an event"
      }`,
      detail: o.email,
    })),
    ...recentEvents.map((e) => ({
      kind: "event" as const,
      at: new Date(e.createdAt).toISOString(),
      title: e.title,
      detail:
        e.status === "published"
          ? `published by ${orgName.get(e.organizationId) ?? "an organiser"}`
          : `${e.status} · ${orgName.get(e.organizationId) ?? "an organiser"}`,
    })),
    ...recentUsers.map((u) => ({
      kind: "signup" as const,
      at: new Date(u.createdAt).toISOString(),
      title: u.name ?? "Someone",
      detail: u.departmentId
        ? `joined · ${deptName.get(u.departmentId) ?? "a department"}`
        : "joined",
    })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 10);

  // Things a person has to do something about. Only non-zero entries are
  // returned, so an empty list genuinely means nothing is waiting.
  const pendingDepartments = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.status, "pending"));

  const drafts = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.status, "draft"));

  const needsYou: { label: string; href: string }[] = [];
  if (pendingDepartments.length > 0) {
    needsYou.push({
      label:
        pendingDepartments.length === 1
          ? "1 department suggestion to review"
          : `${pendingDepartments.length} department suggestions to review`,
      href: "/admin/departments",
    });
  }
  if (drafts.length > 0) {
    needsYou.push({
      label:
        drafts.length === 1
          ? "1 event still in draft"
          : `${drafts.length} events still in draft`,
      href: "/admin/events",
    });
  }

  return NextResponse.json({ items, needsYou });
}
