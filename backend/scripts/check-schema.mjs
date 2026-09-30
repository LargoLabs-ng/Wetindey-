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
