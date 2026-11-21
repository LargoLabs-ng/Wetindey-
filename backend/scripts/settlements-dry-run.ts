// Read-only check of Paystack settlements against Wetin Dey payments.
//
//   npm run settlements:dry-run
//   npm run settlements:dry-run -- --from 2026-01-01 --json settlement-report.json
//
// Reads DATABASE_URL and PAYSTACK_SECRET_KEY from frontend/.env.local (values
// already in the environment win). Writes NOTHING to the database or to
// Paystack:
//   * every database query runs inside a READ ONLY transaction, so even a bug
//     here could not change a row;
//   * Paystack is only ever sent GET requests.
//
// It uses the same matching code the app's sync uses (lib/settlement-
// reconcile.ts), so what this prints is what the sync would write.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { fetchSuccessfulSettlements } from "../lib/paystack-settlements-api";
import {
  reconcileSettlements,
  reportNeedsAttention,
  type LocalPayment,
} from "../lib/settlement-reconcile";

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const file = "frontend/.env.local";
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
  for (const key of ["DATABASE_URL", "PAYSTACK_SECRET_KEY"]) {
    if (process.env[key]) env[key] = process.env[key] as string;
  }
  return env;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const naira = (n: number) =>
  `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function section<T>(title: string, rows: T[], show: (row: T) => string, limit = 20) {
  console.log(`\n${title}: ${rows.length}`);
  for (const row of rows.slice(0, limit)) console.log(`  - ${show(row)}`);
  if (rows.length > limit) console.log(`  … and ${rows.length - limit} more (use --json for all)`);
}

async function main() {
  const env = loadEnv();
  if (!env.DATABASE_URL || !env.PAYSTACK_SECRET_KEY) {
    console.error("DATABASE_URL and PAYSTACK_SECRET_KEY are both needed (frontend/.env.local).");
    process.exit(1);
  }
  const keyMode = env.PAYSTACK_SECRET_KEY.startsWith("sk_live_")
    ? "LIVE"
    : env.PAYSTACK_SECRET_KEY.startsWith("sk_test_")
      ? "TEST"
      : "UNKNOWN";
  const from = arg("from");
  const jsonOut = arg("json");

  console.log("Paystack settlement dry run — READ ONLY, nothing will be written.");
  console.log(`Paystack key: ${keyMode}${keyMode === "TEST" ? " (test mode usually has no real settlements)" : ""}`);
  console.log(`From: ${from ?? "all history"}`);

  console.log("\nReading Paystack settlements …");
  const { settlements, unusable } = await fetchSuccessfulSettlements({
    secretKey: env.PAYSTACK_SECRET_KEY,
    from,
  });
  const references = [
    ...new Set(settlements.flatMap((s) => s.transactions.map((t) => t.reference))),
  ];

  const sql = postgres(env.DATABASE_URL, { max: 1, prepare: false, ssl: "require" });
  try {
    const data = await sql.begin("read only", async (tx) => {
      const [{ present }] = await tx<{ present: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'payments' AND column_name = 'settled_at'
        ) AS present`;

      const settledCols = present
        ? tx`, settled_at, settlement_reference`
        : tx`, NULL::timestamp AS settled_at, NULL::text AS settlement_reference`;
      const refClause =
        references.length > 0 ? tx`OR provider_reference IN ${tx(references)}` : tx``;
      const rows = await tx<
        {
          id: string;
          provider: string;
          provider_reference: string;
          status: string;
          amount: string;
          settled_at: Date | null;
          settlement_reference: string | null;
        }[]
      >`
        SELECT id, provider, provider_reference, status, amount ${settledCols}
        FROM payments
        WHERE provider = 'paystack' ${refClause}`;

      // Legacy Monnify payments are outside this sync. Reported so their
      // impact is visible; never marked settled.
      const [monnify] = await tx<{ count: string; amount: string | null }[]>`
        SELECT count(*)::text AS count, sum(amount)::text AS amount
        FROM payments WHERE provider = 'monnify' AND status = 'success'`;

      return { present, rows, monnify };
    });

    const payments: LocalPayment[] = data.rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      providerReference: r.provider_reference,
      status: r.status,
      amount: r.amount,
      settledAt: r.settled_at,
      settlementReference: r.settlement_reference,
    }));
    const report = reconcileSettlements(settlements, payments);

    console.log(`\nMigration 0022 applied: ${data.present ? "yes" : "no (fine for a dry run)"}`);
    console.log(`Successful settlements read: ${report.settlementsRead}`);
    if (unusable) console.log(`Settlements skipped (no id or date): ${unusable}`);
    console.log(`Transactions inside them: ${report.transactionsRead}`);
    console.log(`Paystack payments in our database: ${payments.filter((p) => p.provider === "paystack").length}`);

    console.log("\n── Would be marked settled ──");
    console.log(`  ${report.toMark.length} payments`);
    console.log(`  Already recorded (no change): ${report.alreadyRecorded}`);
    console.log(
      `  Successful Paystack payments still unsettled afterwards: ${report.stillUnsettled.count} (${naira(report.stillUnsettled.amount)})`
    );

    console.log("\n── Needs a person (NOT written) ──");
    section("Amount or currency mismatch", report.amountMismatch, (r) =>
      `${r.reference}: ours ${naira(r.localAmount)}, Paystack ${r.providerAmountMinor / 100} ${r.currency} (fees ${r.providerFeesMinor ?? "?"})`
    );
    section("Settled by Paystack, not successful here", report.notSuccessLocally, (r) =>
      `${r.reference}: our status "${r.localStatus}", settlement ${r.settlementReference}`
    );
    section("Reference belongs to another provider", report.wrongProvider, (r) =>
      `${r.reference}: ${r.provider}`
    );
    section("Already recorded under a different settlement", report.conflicts, (r) =>
      `${r.reference}: ours ${r.recordedSettlement}, Paystack ${r.providerSettlement}`
    );
    section("Same reference in more than one settlement", report.duplicateInProvider, (r) =>
      `${r.reference}: ${r.settlementReferences.join(", ")}`
    );

    console.log("\n── For information ──");
    section("In a Paystack settlement but not in our payments", report.notFound, (r) =>
      `${r.reference}: ${r.amountMinor / 100} (settlement ${r.settlementReference})`,
      10
    );
    section("Non-success transactions inside settlements", report.nonSuccessTransactions, (r) =>
      `${r.reference}: ${r.status}`,
      10
    );
    console.log(
      `\nLegacy Monnify payments (outside this sync, left unsettled): ${data.monnify.count} worth ${naira(Number(data.monnify.amount ?? 0))}`
    );

    if (jsonOut) {
      writeFileSync(jsonOut, JSON.stringify({ generatedAt: new Date(), keyMode, from: from ?? null, unusable, report, monnify: data.monnify }, null, 2));
      console.log(`\nFull report written to ${jsonOut} (references only, no buyer details).`);
    }

    console.log(
      reportNeedsAttention(report)
        ? "\nRESULT: review the items above before switching settlement writes on."
        : "\nRESULT: clean — every settled Paystack transaction matched a payment here, or is listed for information only."
    );
    console.log("No changes were made.");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("Dry run failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
