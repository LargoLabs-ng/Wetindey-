// Asks the database what it actually has, and names any migration that
// hasn't landed.
//
//   npm run db:check
//
// Reads nothing but information_schema and pg_type, writes nothing, and
// changes nothing. Safe to run any time.
//
// Why this exists: `npx tsc --noEmit` passing proves the code agrees with
// schema.ts. It says nothing about whether Postgres agrees with either — and
// a missing column doesn't surface until a real page 500s in front of a real
// student. This closes that gap in two seconds.
import { readFileSync } from "node:fs";
import postgres from "postgres";

const env = {};
for (const line of readFileSync("frontend/.env.local", "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > 0) {
    env[t.slice(0, i).trim()] = t
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
}

const url = env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not found in frontend/.env.local");
  process.exit(1);
}

/**
 * What each migration should have left behind.
 *
 * Deliberately a handful of markers per migration rather than every object
 * it creates: enough to tell "ran" from "didn't", without a list that has to
 * be maintained in lockstep with the SQL.
 */
const EXPECT = [
  {
    migration: "0009_finance_switch.sql",
    columns: [["event_staff", "can_see_finances"]],
    tables: [],
    types: [],
  },
  {
    migration: "0010_payouts.sql",
    columns: [
      ["organizations", "bank_account_number"],
      ["payouts", "requested_at"],
      ["payouts", "note"],
    ],
    tables: [],
    types: [],
  },
  {
    migration: "0011_organiser_toolkit.sql",
    columns: [
      ["events", "logo_url"],
      ["events", "gallery"],
      ["events", "sponsors"],
      ["events", "after_purchase_note"],
      ["ticket_types", "admits"],
      ["ticket_types", "flash_ends_at"],
      ["orders", "promo_code_id"],
      ["orders", "discount_amount"],
    ],
    tables: ["registration_fields", "registration_answers", "promo_codes"],
    types: ["registration_field_kind", "promo_code_kind"],
  },
  {
    migration: "0012_provisional_details.sql",
    columns: [
      ["events", "date_tbd"],
      ["events", "venue_tbd"],
    ],
    tables: [],
    types: [],
  },
  {
    migration: "0014_monnify_payments.sql",
    columns: [["refunds", "status"]],
    tables: [],
    types: ["refund_status"],
  },
  {
    migration: "0015_paystack_checkout.sql",
    columns: [["orders", "platform_fee_paid_by"]],
    tables: [],
    types: [],
  },
  {
    migration: "0016_owner_crm_and_admin_archive.sql",
    columns: [
      ["events", "archived_at"],
      ["orders", "marketing_consent"],
    ],
    tables: [
      "crm_tags",
      "crm_contact_tags",
      "crm_contact_preferences",
    ],
    types: [],
  },
  {
    migration: "0017_early_bird_pricing.sql",
    columns: [
      ["events", "time_zone"],
      ["ticket_types", "early_bird_enabled"],
      ["ticket_types", "early_bird_price"],
      ["ticket_types", "early_bird_ends_at"],
      ["orders", "ticket_unit_price"],
      ["payments", "manual_review_required"],
      ["payments", "manual_review_reason"],
      ["payments", "manual_review_resolved_at"],
      ["payments", "manual_review_note"],
      ["payments", "manual_review_resolved_by"],
    ],
    tables: [],
    types: [],
  },
  {
    migration: "0018_platform_admin_rbac.sql",
    columns: [
      ["platform_admin_roles", "is_system"],
      ["platform_admin_assignments", "assigned_by"],
      ["platform_admin_assignments", "status"],
    ],
    tables: [
      "platform_admin_roles",
      "platform_admin_permissions",
      "platform_admin_role_permissions",
      "platform_admin_assignments",
    ],
    types: [],
  },
  {
    migration: "0019_ticket_price_history.sql",
    columns: [
      ["ticket_type_price_history", "ticket_type_id"],
      ["ticket_type_price_history", "valid_from"],
      ["ticket_type_price_history", "valid_until"],
    ],
    tables: ["ticket_type_price_history"],
    types: [],
  },
  {
    migration: "0020_event_visibility.sql",
    columns: [["events", "visibility"]],
    tables: [],
    types: ["event_visibility"],
  },
];

const sql = postgres(url, { max: 1, prepare: false, ssl: "require" });

try {
  const columnRows = await sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `;
  const haveColumn = new Set(
    columnRows.map((r) => `${r.table_name}.${r.column_name}`)
  );

  const tableRows = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `;
  const haveTable = new Set(tableRows.map((r) => r.table_name));

  const typeRows = await sql`SELECT typname FROM pg_type`;
  const haveType = new Set(typeRows.map((r) => r.typname));

  let allGood = true;

  for (const step of EXPECT) {
    const missing = [];

    for (const [table, column] of step.columns) {
      if (!haveColumn.has(`${table}.${column}`)) {
        missing.push(`column ${table}.${column}`);
      }
    }
    for (const table of step.tables) {
      if (!haveTable.has(table)) missing.push(`table ${table}`);
    }
    for (const type of step.types) {
      if (!haveType.has(type)) missing.push(`type ${type}`);
    }

    if (missing.length === 0) {
      console.log(`  OK      ${step.migration}`);
    } else {
      allGood = false;
      // Partial is worth shouting about: it usually means the file failed
      // part-way, and re-running is safe but somebody has to decide to.
      const label = missing.length === countOf(step) ? "NOT RUN" : "PARTIAL";
      console.log(`  ${label} ${step.migration}`);
      for (const m of missing) console.log(`            missing ${m}`);
      console.log(
        `            fix: npm run db:migrate -- backend/migrations/${step.migration}`
      );
    }
  }

  console.log("");
  console.log(
    allGood
      ? "Database matches schema.ts. Nothing to run."
      : "Run the migrations listed above, then this again."
  );
  if (!allGood) process.exitCode = 1;
} catch (error) {
  console.error("Check failed:", error.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}

function countOf(step) {
  return step.columns.length + step.tables.length + step.types.length;
}
