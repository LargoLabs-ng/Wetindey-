export const ADMIN_ROLE_PERMISSIONS = {
  super_admin: [
    "users.view",
    "users.create",
    "users.edit",
    "users.delete",
    "organisers.view",
    "organisers.edit",
    "organisers.suspend",
    "events.view",
    "events.create",
    "events.edit",
    "events.publish",
    "events.delete",
    "tickets.view",
    "tickets.edit",
    "tickets.delete",
    "transactions.view",
    "refunds.manage",
    "finance.view",
    "finance.manage",
    "content.manage",
    "admins.manage",
    "roles.manage",
    "audit.view",
    "settings.manage",
  ],
  admin: [
    "users.view",
    "users.create",
    "users.edit",
    "organisers.view",
    "organisers.edit",
    "organisers.suspend",
    "events.view",
    "events.create",
    "events.edit",
    "events.publish",
    "tickets.view",
    "tickets.edit",
    "content.manage",
  ],
  finance_admin: [
    "transactions.view",
    "refunds.manage",
    "finance.view",
  ],
  event_moderator: [
    "events.view",
    "events.edit",
    "events.publish",
    "tickets.view",
  ],
  support_admin: [
    "users.view",
    "organisers.view",
    "events.view",
    "tickets.view",
    "transactions.view",
  ],
} as const;

export type AdminRole = keyof typeof ADMIN_ROLE_PERMISSIONS;
export type AdminPermission =
  (typeof ADMIN_ROLE_PERMISSIONS)[AdminRole][number];

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  finance_admin: "Finance Admin",
  event_moderator: "Event Moderator",
  support_admin: "Support Admin",
};

export function defaultRoleHasPermission(
  role: AdminRole,
  permission: AdminPermission
): boolean {
  return ADMIN_ROLE_PERMISSIONS[role].some(
    (candidate) => candidate === permission
  );
}

export function isAdminRole(value: string): value is AdminRole {
  return Object.hasOwn(ADMIN_ROLE_PERMISSIONS, value);
}
