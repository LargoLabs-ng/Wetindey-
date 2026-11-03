CREATE TABLE IF NOT EXISTS "platform_admin_roles" (
  "id" varchar(40) PRIMARY KEY NOT NULL,
  "name" varchar(100) NOT NULL,
  "description" text,
  "is_system" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "platform_admin_permissions" (
  "id" varchar(80) PRIMARY KEY NOT NULL,
  "description" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "platform_admin_role_permissions" (
  "role_id" varchar(40) NOT NULL REFERENCES "platform_admin_roles"("id") ON DELETE CASCADE,
  "permission_id" varchar(80) NOT NULL REFERENCES "platform_admin_permissions"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "platform_admin_role_permission_unique"
  ON "platform_admin_role_permissions" ("role_id", "permission_id");

CREATE TABLE IF NOT EXISTS "platform_admin_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "role_id" varchar(40) NOT NULL REFERENCES "platform_admin_roles"("id"),
  "status" varchar(20) NOT NULL DEFAULT 'active',
  "assigned_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "assigned_at" timestamp NOT NULL DEFAULT now(),
  "suspended_at" timestamp
);
CREATE INDEX IF NOT EXISTS "platform_admin_assignments_role_idx"
  ON "platform_admin_assignments" ("role_id", "status");

INSERT INTO "platform_admin_roles" ("id", "name", "description") VALUES
  ('super_admin', 'Super Admin', 'Complete platform access and administrator management.'),
  ('admin', 'Admin', 'Manage users, organisers, events, tickets and content.'),
  ('finance_admin', 'Finance Admin', 'View financial records and manage authorised refunds.'),
  ('event_moderator', 'Event Moderator', 'Review and moderate events.'),
  ('support_admin', 'Support Admin', 'Read-only customer support access.')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "platform_admin_permissions" ("id", "description") VALUES
  ('users.view', 'View user accounts.'),
  ('users.create', 'Create user accounts.'),
  ('users.edit', 'Edit user accounts.'),
  ('users.delete', 'Delete or anonymise eligible user accounts.'),
  ('organisers.view', 'View organiser profiles.'),
  ('organisers.edit', 'Edit organiser profiles.'),
  ('organisers.suspend', 'Suspend or reactivate organiser access.'),
  ('events.view', 'View platform events.'),
  ('events.create', 'Create platform events.'),
  ('events.edit', 'Edit platform events.'),
  ('events.publish', 'Publish or moderate platform events.'),
  ('events.delete', 'Delete or archive eligible events.'),
  ('tickets.view', 'View platform ticket tiers and issued tickets.'),
  ('tickets.edit', 'Edit platform ticket tiers.'),
  ('tickets.delete', 'Delete or archive eligible ticket tiers.'),
  ('transactions.view', 'View payment transactions.'),
  ('refunds.manage', 'Manage authorised refunds.'),
  ('finance.view', 'View platform financial reports.'),
  ('finance.manage', 'Manage platform finance settings.'),
  ('content.manage', 'Manage public website content.'),
  ('admins.manage', 'Manage administrator assignments.'),
  ('roles.manage', 'Manage administrative roles and permissions.'),
  ('audit.view', 'View audit logs.'),
  ('settings.manage', 'Manage platform settings.')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "platform_admin_role_permissions" ("role_id", "permission_id")
SELECT 'super_admin', "id" FROM "platform_admin_permissions"
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "platform_admin_role_permissions" ("role_id", "permission_id") VALUES
  ('admin', 'users.view'),
  ('admin', 'users.create'),
  ('admin', 'users.edit'),
  ('admin', 'organisers.view'),
  ('admin', 'organisers.edit'),
  ('admin', 'organisers.suspend'),
  ('admin', 'events.view'),
  ('admin', 'events.create'),
  ('admin', 'events.edit'),
  ('admin', 'events.publish'),
  ('admin', 'tickets.view'),
  ('admin', 'tickets.edit'),
  ('admin', 'content.manage'),
  ('finance_admin', 'transactions.view'),
  ('finance_admin', 'refunds.manage'),
  ('finance_admin', 'finance.view'),
  ('event_moderator', 'events.view'),
  ('event_moderator', 'events.edit'),
  ('event_moderator', 'events.publish'),
  ('event_moderator', 'tickets.view'),
  ('support_admin', 'users.view'),
  ('support_admin', 'organisers.view'),
  ('support_admin', 'events.view'),
  ('support_admin', 'tickets.view'),
  ('support_admin', 'transactions.view')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
