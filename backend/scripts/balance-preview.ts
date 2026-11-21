// Read-only preview: what every organiser's balance is today, and what it
// becomes under the Stage 2 rules (settled-only, partial-refund fix).
//
//   npm run balance:preview
//   npm run balance:preview -- --json balance-preview.json
//
// Same safety as the settlement dry run: a READ ONLY database transaction
// and GET-only Paystack requests. Settlement is taken from Paystack directly
// (exactly what the sync would record), so this works before migration 0022
// is applied or the sync has run.
//
// Legacy Monnify processing fees are not read here (there are no Monnify
// payments), and Paystack fees are buyer-paid, so neither changes a balance.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { fetchSuccessfulSettlements } from "../lib/paystack-settlements-api";
import { reconcileSettlements, type LocalPayment } from "../lib/settlement-reconcile";
import { computeEarnings, type EarningsOrderInput } from "../lib/earnings-compute";
import { quoteOrder, type FeeBearer } from "../lib/fees";

function loadEnv(file: string): Record<string, string> {
  const env: Record<string, string> = {};
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
const round2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const env = loadEnv(arg("env") ?? process.env.WD_ENV_FILE ?? "frontend/.env.local");
  if (!env.DATABASE_URL || !env.PAYSTACK_SECRET_KEY) {
    console.error("DATABASE_URL and PAYSTACK_SECRET_KEY are both needed.");
    process.exit(1);
  }
  console.log("Balance preview — READ ONLY, nothing will be written.\n");

  const { settlements } = await fetchSuccessfulSettlements({ secretKey: env.PAYSTACK_SECRET_KEY });
  const references = [...new Set(settlements.flatMap((s) => s.transactions.map((t) => t.reference)))];

  const sql = postgres(env.DATABASE_URL, { max: 1, prepare: false, ssl: "require" });
  try {
    const data = await sql.begin("read only", async (tx) => {
      const [{ present }] = await tx<{ present: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'payments' AND column_name = 'settled_at') AS present`;
      const settledCols = present
        ? tx`, settled_at, settlement_reference`
        : tx`, NULL::timestamp AS settled_at, NULL::text AS settlement_reference`;
      const refClause = references.length ? tx`OR provider_reference IN ${tx(references)}` : tx``;

      const orgs = await tx<{ id: string; name: string }[]>`SELECT id, name FROM organizations`;
      const events = await tx<{ id: string; organization_id: string }[]>`SELECT id, organization_id FROM events`;
      const orders = await tx<{ id: string; event_id: string; status: string; subtotal: string; fees: string; platform_fee_paid_by: FeeBearer }[]>`
        SELECT id, event_id, status, subtotal, fees, platform_fee_paid_by
        FROM orders WHERE status IN ('paid', 'refunded')`;
      const counts = await tx<{ order_id: string; total: number; kept: number }[]>`
        SELECT order_id, count(*)::int AS total,
               (count(*) FILTER (WHERE status IN ('valid', 'checked_in')))::int AS kept
        FROM tickets GROUP BY order_id`;
      const successPayments = await tx<{ order_id: string; provider: string; provider_reference: string }[]>`
        SELECT order_id, provider, provider_reference FROM payments WHERE status = 'success'`;
      const reconcileRows = await tx<{ id: string; provider: string; provider_reference: string; status: string; amount: string; settled_at: Date | null; settlement_reference: string | null }[]>`
        SELECT id, provider, provider_reference, status, amount ${settledCols}
        FROM payments WHERE provider = 'paystack' ${refClause}`;
      const refunds = await tx<{ order_id: string }[]>`
        SELECT DISTINCT order_id FROM refunds WHERE status = 'completed'`;
      const payouts = await tx<{ id: string; organization_id: string; net_amount: string; status: string; requested_at: Date }[]>`
        SELECT id, organization_id, net_amount, status, requested_at FROM payouts ORDER BY requested_at`;
      return { orgs, events, orders, counts, successPayments, reconcileRows, refunds, payouts };
    });

    // Which payments are settled: already recorded, or what the sync would record.
    const local: LocalPayment[] = data.reconcileRows.map((r) => ({
      id: r.id, provider: r.provider, providerReference: r.provider_reference, status: r.status,
      amount: r.amount, settledAt: r.settled_at, settlementReference: r.settlement_reference,
    }));
    const report = reconcileSettlements(settlements, local);
    const settledRefs = new Set([
      ...local.filter((p) => p.settledAt).map((p) => p.providerReference),
      ...report.toMark.map((m) => m.providerReference),
    ]);

    const orgOfEvent = new Map(data.events.map((e) => [e.id, e.organization_id]));
    const countsByOrder = new Map(data.counts.map((c) => [c.order_id, c]));
    const paymentByOrder = new Map(data.successPayments.map((p) => [p.order_id, p]));
    const refundedOrders = new Set(data.refunds.map((r) => r.order_id));

    const rows = data.orgs.map((org) => {
      const orgOrders = data.orders.filter((o) => orgOfEvent.get(o.event_id) === org.id);
      const orgPayouts = data.payouts.filter((p) => p.organization_id === org.id);

      // ── Today's rules (lib/earnings.ts before Stage 2) ──
      let oldNet = 0;
      for (const o of orgOrders) {
        if (o.status !== "paid" || refundedOrders.has(o.id)) continue;
        oldNet += quoteOrder(Number(o.subtotal), { platformFeePaidBy: o.platform_fee_paid_by }).organizerNet;
      }
      let oldPaid = 0, oldPending = 0;
      for (const p of orgPayouts) {
        if (p.status === "paid") oldPaid += Number(p.net_amount);
        else if (p.status === "pending" || p.status === "processing") oldPending += Number(p.net_amount);
      }
      const oldAvailable = Math.max(0, round2(oldNet - oldPaid - oldPending));

      // ── Stage 2 rules ──
      const inputs: EarningsOrderInput[] = orgOrders.map((o) => {
        const c = countsByOrder.get(o.id);
        const pay = paymentByOrder.get(o.id);
        return {
          id: o.id, eventId: o.event_id, status: o.status, subtotal: o.subtotal, fees: o.fees,
          platformFeePaidBy: o.platform_fee_paid_by,
          ticketCount: c?.total ?? 0, keptTicketCount: c?.kept ?? 0,
          payment: pay
            ? {
                provider: pay.provider,
                // Free orders never touch a provider: nothing to settle.
                settledAt: pay.provider === "free" || settledRefs.has(pay.provider_reference) ? new Date() : null,
                organizerProcessingFee: 0,
                buyerProcessingFee: 0,
              }
            : null,
        };
      });
      const e = computeEarnings(inputs, orgPayouts.map((p) => ({ netAmount: p.net_amount, status: p.status })));
      const open = orgPayouts.filter((p) => ["pending", "approved", "processing", "failed"].includes(p.status));
      return { organisation: org.name, organizationId: org.id, oldAvailable, oldNetEarned: round2(oldNet), earnings: e, openRequests: open };
    }).filter((r) => r.earnings.netEarned !== 0 || r.oldNetEarned !== 0 || r.openRequests.length > 0);

    for (const r of rows) {
      const e = r.earnings;
      console.log(`■ ${r.organisation}`);
      console.log(`    Available today (old rules):   ${naira(r.oldAvailable)}`);
      console.log(`    Earned (new rules):            ${naira(e.netEarned)}   (old rules: ${naira(r.oldNetEarned)})`);
      console.log(`      settled by Paystack:         ${naira(e.settledNet)}`);
      console.log(`      waiting for Paystack:        ${naira(e.unsettledNet)}`);
      console.log(`    Paid out / requested:          ${naira(e.paidOut)} / ${naira(e.committed)}`);
      console.log(`    Available after Stage 2:       ${naira(e.available)}`);
      for (const p of r.openRequests) {
        console.log(`    Open request ${naira(Number(p.net_amount))} (${p.status}, ${new Date(p.requested_at).toISOString().slice(0, 10)})`);
      }
      if (e.shortfall > 0) {
        console.log(`    ⚠ REVIEW: open requests exceed settled money by ${naira(e.shortfall)}. Status will NOT be changed automatically.`);
      }
      console.log("");
    }

    const flagged = rows.filter((r) => r.earnings.shortfall > 0);
    console.log(`Organisations with money: ${rows.length}`);
    console.log(`Needing manual review (requests above settled balance): ${flagged.length}`);
    const jsonOut = arg("json");
    if (jsonOut) {
      writeFileSync(jsonOut, JSON.stringify({ generatedAt: new Date(), rows }, null, 2));
      console.log(`Full preview written to ${jsonOut} (organisation names and amounts only).`);
    }
    console.log("No changes were made.");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("Preview failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
