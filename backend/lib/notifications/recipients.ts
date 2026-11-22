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
  platformAdminAssignments,
  platformAdminRolePermissions,
  users,
} from "@/db/schema";
import type { AdminPermission } from "@/lib/admin-rbac";

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
