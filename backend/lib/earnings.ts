import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, orders, payments, payouts, tickets } from "@/db/schema";
import {
  computeEarnings,
  type Earnings,
  type EarningsOrderInput,
} from "@/lib/earnings-compute";
import { monnifyFeeFromStoredResponse } from "@/lib/monnify";
import { paystackFeeFromStoredResponse } from "@/lib/paystack";

/**
 * What an organisation has earned, and what it can actually withdraw.
 *
 * One function, because this number gets shown in several places and an
 * organiser comparing two of them and finding different figures will — quite
 * reasonably — stop trusting all of them. The rules themselves live in
 * lib/earnings-compute.ts; this file only loads the rows they need.
 */
export type { Earnings } from "@/lib/earnings-compute";

export type LoadedOrder = EarningsOrderInput & { createdAt: Date };

/**
 * Where queries run: the shared connection, or an open transaction. The
 * withdrawal path passes its transaction so the balance it checks is read
 * under the same lock as the request it inserts — with one connection per
 * function, querying `db` from inside a transaction would also simply wait
 * forever for itself.
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = typeof db | Tx;

/** Tickets that still count for the organiser. */
const LIVE_TICKET_STATUSES = ["valid", "checked_in"] as const;

function isMissingColumn(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "42703"
  );
}

let warnedMissingSettlement = false;

async function loadSuccessfulPayments(orderIds: string[] | null, exec: Executor) {
  const where = orderIds
    ? and(inArray(payments.orderId, orderIds), eq(payments.status, "success"))
    : eq(payments.status, "success");
  try {
    return await exec
      .select({
        orderId: payments.orderId,
        provider: payments.provider,
        rawProviderResponse: payments.rawProviderResponse,
        settledAt: payments.settledAt,
      })
      .from(payments)
      .where(where);
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
    // Migration 0022 not applied yet. Treat everything as unsettled: it can
    // only make the withdrawable figure too LOW, never too high.
    if (!warnedMissingSettlement) {
      console.error(
        "payments.settled_at is missing — apply migration 0022. Treating all revenue as unsettled."
      );
      warnedMissingSettlement = true;
    }
    const rows = await exec
      .select({
        orderId: payments.orderId,
        provider: payments.provider,
        rawProviderResponse: payments.rawProviderResponse,
      })
      .from(payments)
      .where(where);
    return rows.map((row) => ({ ...row, settledAt: null as Date | null }));
  }
}

/**
 * Paid and refunded orders for the given events (every event when `eventIds`
 * is null), with their ticket counts and successful payment.
 */
export async function loadEarningsOrders(
  eventIds: string[] | null,
  exec: Executor = db
): Promise<LoadedOrder[]> {
  if (eventIds && eventIds.length === 0) return [];

  const orderWhere = eventIds
    ? and(inArray(orders.eventId, eventIds), inArray(orders.status, ["paid", "refunded"]))
    : inArray(orders.status, ["paid", "refunded"]);

  const orderRows = await exec
    .select({
      id: orders.id,
      eventId: orders.eventId,
      status: orders.status,
      subtotal: orders.subtotal,
      fees: orders.fees,
      platformFeePaidBy: orders.platformFeePaidBy,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(orderWhere);
  if (orderRows.length === 0) return [];

  const orderIds = eventIds ? orderRows.map((o) => o.id) : null;

  const ticketWhere = orderIds ? inArray(tickets.orderId, orderIds) : undefined;
  const ticketCounts = await exec
    .select({
      orderId: tickets.orderId,
      total: sql<number>`count(*)::int`,
      kept: sql<number>`(count(*) filter (where ${inArray(tickets.status, [...LIVE_TICKET_STATUSES])}))::int`,
    })
    .from(tickets)
    .where(ticketWhere)
    .groupBy(tickets.orderId);
  const countsByOrder = new Map(ticketCounts.map((c) => [c.orderId, c]));

  const paymentRows = await loadSuccessfulPayments(orderIds, exec);
  const paymentByOrder = new Map<string, EarningsOrderInput["payment"]>();
  for (const payment of paymentRows) {
    const fee =
      payment.provider === "monnify"
        ? monnifyFeeFromStoredResponse(payment.rawProviderResponse)
        : payment.provider === "paystack"
          ? paystackFeeFromStoredResponse(payment.rawProviderResponse)
          : null;
    const candidate = {
      provider: payment.provider,
      settledAt: payment.settledAt ? new Date(payment.settledAt) : null,
      organizerProcessingFee: payment.provider === "monnify" ? fee ?? 0 : 0,
      buyerProcessingFee: payment.provider === "paystack" ? fee ?? 0 : 0,
    };
    const existing = paymentByOrder.get(payment.orderId);
    // Two successful payments on one order should not happen; if it does,
    // prefer the settled one rather than hiding money that arrived.
    if (!existing || (!existing.settledAt && candidate.settledAt)) {
      paymentByOrder.set(payment.orderId, candidate);
    }
  }

  return orderRows.map((order) => {
    const counts = countsByOrder.get(order.id);
    return {
      id: order.id,
      eventId: order.eventId,
      status: order.status,
      subtotal: order.subtotal,
      fees: order.fees,
      platformFeePaidBy: order.platformFeePaidBy,
      createdAt: order.createdAt,
      ticketCount: Number(counts?.total ?? 0),
      keptTicketCount: Number(counts?.kept ?? 0),
      payment: paymentByOrder.get(order.id) ?? null,
    };
  });
}

export async function earningsForOrganization(
  organizationId: string,
  exec: Executor = db
): Promise<Earnings> {
  const orgEvents = await exec
    .select({ id: events.id })
    .from(events)
    .where(eq(events.organizationId, organizationId));

  // One after the other, not in parallel: inside a transaction there is a
  // single connection, and queries on it run in turn anyway.
  const orderInputs = await loadEarningsOrders(orgEvents.map((e) => e.id), exec);
  const payoutRows = await exec
    .select({ netAmount: payouts.netAmount, status: payouts.status })
    .from(payouts)
    .where(eq(payouts.organizationId, organizationId));

  return computeEarnings(orderInputs, payoutRows);
}

/**
 * One event's figures. Payouts are account-wide, so they do not appear here:
 * paidOut / committed / available are 0 and should not be shown per event.
 */
export async function earningsForEvent(eventId: string): Promise<Earnings> {
  return computeEarnings(await loadEarningsOrders([eventId]), []);
}
