/**
 * Shared recipient lookups, using the existing permission rules.
 *
 * Checked when the notification is built, not when the event happened, so
 * someone removed from a role stops receiving its notifications straight
 * away.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  eventStaff,
  events,
  organizationMembers,
  organizations,
  platformAdminAssignments,
  platformAdminRolePermissions,
  users,
} from "@/db/schema";
import type { AdminPermission } from "@/lib/admin-rbac";
import type { OrgRole } from "@/lib/authz";
import { can, type Capability } from "@/lib/permissions";

export type Person = { userId: string; email: string; firstName: string | null };

/**
 * Admins who hold `permission`: anyone with an active admin role that grants
 * it, plus the ADMIN_EMAILS addresses (who count as Super Admin everywhere,
 * as in authz.ts). Only people with an account can be notified in-app.
 */
export async function adminsWithPermission(permission: AdminPermission): Promise<Person[]> {
  const people = new Map<string, Person>();

  try {
    const assigned = await db
      .select({ userId: users.id, email: users.email, firstName: users.firstName })
      .from(platformAdminAssignments)
      .innerJoin(
        platformAdminRolePermissions,
        eq(platformAdminRolePermissions.roleId, platformAdminAssignments.roleId)
      )
      .innerJoin(users, eq(users.id, platformAdminAssignments.userId))
      .where(
        and(
          eq(platformAdminAssignments.status, "active"),
          eq(platformAdminRolePermissions.permissionId, permission)
        )
      );
    for (const p of assigned) people.set(p.userId, p);
  } catch (error) {
    // Databases without the admin-roles tables (0018) still have ADMIN_EMAILS.
    if ((error as { code?: string })?.code !== "42P01") throw error;
  }

  const allowlist = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length > 0) {
    const listed = await db
      .select({ userId: users.id, email: users.email, firstName: users.firstName })
      .from(users)
      .where(inArray(sql`lower(${users.email})`, allowlist));
    for (const p of listed) people.set(p.userId, p);
  }

  return [...people.values()];
}

/**
 * Super admins: active `super_admin` assignments plus ADMIN_EMAILS. Most admin
 * pages today (payment reviews, departments) are Super Admin only, so their
 * alerts go to the same people.
 */
export async function superAdmins(): Promise<Person[]> {
  const people = new Map<string, Person>();
  try {
    const assigned = await db
      .select({ userId: users.id, email: users.email, firstName: users.firstName })
      .from(platformAdminAssignments)
      .innerJoin(users, eq(users.id, platformAdminAssignments.userId))
      .where(
        and(
          eq(platformAdminAssignments.status, "active"),
          eq(platformAdminAssignments.roleId, "super_admin")
        )
      );
    for (const p of assigned) people.set(p.userId, p);
  } catch (error) {
    if ((error as { code?: string })?.code !== "42P01") throw error;
  }
  const allowlist = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length > 0) {
    const listed = await db
      .select({ userId: users.id, email: users.email, firstName: users.firstName })
      .from(users)
      .where(inArray(sql`lower(${users.email})`, allowlist));
    for (const p of listed) people.set(p.userId, p);
  }
  return [...people.values()];
}

/**
 * An organization's owners: the owner on the organization row, plus any
 * active member with the owner role. Payouts and bank alerts go only here.
 */
export async function organizationOwners(organizationId: string): Promise<Person[]> {
  const people = new Map<string, Person>();
  const [org] = await db
    .select({ userId: users.id, email: users.email, firstName: users.firstName })
    .from(organizations)
    .innerJoin(users, eq(users.id, organizations.ownerId))
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (org) people.set(org.userId, org);
  const members = await db
    .select({ userId: users.id, email: users.email, firstName: users.firstName })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.role, "owner"),
        eq(organizationMembers.status, "active")
      )
    );
  for (const m of members) people.set(m.userId, m);
  return [...people.values()];
}

/**
 * Everyone on an event's team who holds `capability`, using the same rules
 * as the dashboard (lib/permissions.ts): the organization's owners always;
 * staff only while their event_staff row is active, by role and by the
 * "can see finances" switch. So "finance:view" means the owner plus
 * finance-authorized staff, and "event:edit" means the owner plus editors.
 */
export async function eventTeam(eventId: string, capability: Capability): Promise<Person[]> {
  const [event] = await db
    .select({ organizationId: events.organizationId })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!event) return [];

  const people = new Map<string, Person>();
  for (const owner of await organizationOwners(event.organizationId)) {
    people.set(owner.userId, owner);
  }

  const staff = await db
    .select({
      userId: users.id,
      email: users.email,
      firstName: users.firstName,
      role: eventStaff.role,
      canSeeFinances: eventStaff.canSeeFinances,
    })
    .from(eventStaff)
    .innerJoin(users, eq(users.id, eventStaff.userId))
    .where(and(eq(eventStaff.eventId, eventId), eq(eventStaff.status, "active")));
  for (const s of staff) {
    if (can(s.role as OrgRole, capability, { canSeeFinances: s.canSeeFinances })) {
      people.set(s.userId, { userId: s.userId, email: s.email, firstName: s.firstName });
    }
  }
  return [...people.values()];
}
