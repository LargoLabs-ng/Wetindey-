import { readFileSync } from "node:fs";
import postgres from "postgres";

const [targetEmailArg, roleIdArg] = process.argv.slice(2);
if (!targetEmailArg || !roleIdArg) {
  console.error(
    "Usage: npm run db:admin-provision -- <user-email> <role-id>"
  );
  process.exit(1);
}

const targetEmail = targetEmailArg.trim().toLowerCase();
const roleId = roleIdArg.trim();
if (
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail) ||
  !/^[a-z_]+$/.test(roleId)
) {
  console.error("Provide a valid email address and role ID.");
  process.exit(1);
}

const env = {};
for (const line of readFileSync("frontend/.env.local", "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const separator = trimmed.indexOf("=");
  if (separator > 0) {
    env[trimmed.slice(0, separator).trim()] = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
}

const url = env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not found in frontend/.env.local");
  process.exit(1);
}

const trustedAdminEmails = (env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
const provisionedByEmail = (
  env.ADMIN_PROVISIONED_BY_EMAIL ??
  process.env.ADMIN_PROVISIONED_BY_EMAIL ??
  ""
)
  .trim()
  .toLowerCase();

const sql = postgres(url, { max: 1, prepare: false, ssl: "require" });

try {
  await sql.begin(async (tx) => {
    const [target] = await tx`
      SELECT id, email
      FROM users
      WHERE lower(email) = ${targetEmail}
      LIMIT 1
    `;
    if (!target) {
      throw new Error(
        `No user exists for ${targetEmail}. They must register before assignment.`
      );
    }

    const [role] = await tx`
      SELECT id
      FROM platform_admin_roles
      WHERE id = ${roleId}
      LIMIT 1
    `;
    if (!role) {
      throw new Error(`Unknown role "${roleId}". Apply migration 0018 first.`);
    }

    let assignedBy = null;
    if (roleId === "super_admin") {
      if (!trustedAdminEmails.includes(targetEmail)) {
        throw new Error(
          "A Super Admin target must be included in ADMIN_EMAILS before provisioning."
        );
      }
    } else {
      if (!provisionedByEmail) {
        throw new Error(
          "Set ADMIN_PROVISIONED_BY_EMAIL to an existing trusted Super Admin."
        );
      }
      const [operator] = await tx`
        SELECT id
        FROM users
        WHERE lower(email) = ${provisionedByEmail}
        LIMIT 1
      `;
      if (!operator) {
        throw new Error(
          `No provisioning user exists for ${provisionedByEmail}.`
        );
      }
      const trustedOperator = trustedAdminEmails.includes(provisionedByEmail);
      if (!trustedOperator) {
        const [assignment] = await tx`
          SELECT id
          FROM platform_admin_assignments
          WHERE user_id = ${operator.id}
            AND role_id = 'super_admin'
            AND status = 'active'
          LIMIT 1
        `;
        if (!assignment) {
          throw new Error(
            "The provisioning user is not an active trusted Super Admin."
          );
        }
      }
      assignedBy = operator.id;
    }

    const [existing] = await tx`
      SELECT id
      FROM platform_admin_assignments
      WHERE user_id = ${target.id}
      LIMIT 1
    `;
    if (existing) {
      throw new Error(
        `${targetEmail} already has an admin assignment; refusing to overwrite it.`
      );
    }

    await tx`
      INSERT INTO platform_admin_assignments (user_id, role_id, assigned_by)
      VALUES (${target.id}, ${roleId}, ${assignedBy})
    `;
  });
  console.log(`Assigned ${roleId} to ${targetEmail}.`);
} catch (error) {
  console.error("Admin provisioning failed:", error.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
