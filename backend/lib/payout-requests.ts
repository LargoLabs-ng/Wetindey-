/**
 * Creating payout requests and moving them through their lifecycle.
 *
 * Both run inside one database transaction that first LOCKS a row:
 *   - a new request locks the organisation, so two requests sent at the same
 *     moment are checked one after the other and cannot overspend together;
 *   - an admin action locks the payout, so two admins (or a double tap)
 *     cannot both move it, and the status they saw is the status they change.
 * Every change writes a payout_events row in the same transaction: the
 * history can never disagree with the request.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, organizations, payoutEvents, payouts, users } from "@/db/schema";
import { earningsForEvent, earningsForOrganization } from "@/lib/earnings";
import type { Earnings } from "@/lib/earnings-compute";
import {
  allowedActions,
  validateAction,
  type ActionInput,
  type PayoutStatus,
} from "@/lib/payout-lifecycle";

export class PayoutRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public extra: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

const toKobo = (naira: number) => Math.round(naira * 100);

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown; cause?: { code?: unknown } } | null);
  return code?.code === "23505" || code?.cause?.code === "23505";
}

// ── Organiser: ask for money ────────────────────────────────────────────

export async function createWithdrawalRequest(input: {
  organizationId: string;
  userId: string;
  amount: number;
}): Promise<{ id: string; availableBefore: number }> {
  const amountKobo = toKobo(input.amount);
  if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0) {
    throw new PayoutRequestError("Enter an amount above zero.", 400);
  }

  return db.transaction(async (tx) => {
    // The lock. A second request for this organisation waits here until the
    // first has committed, then sees its amount as committed.
    const [org] = await tx
      .select({
        id: organizations.id,
        bankName: organizations.bankName,
        bankAccountName: organizations.bankAccountName,
        bankAccountNumber: organizations.bankAccountNumber,
      })
      .from(organizations)
      .where(eq(organizations.id, input.organizationId))
      .for("update");

    if (!org) throw new PayoutRequestError("No organisation found.", 404);
    if (!org.bankAccountNumber) {
      throw new PayoutRequestError("Add your bank account before requesting a payout.", 400);
    }

    // Recomputed under the lock rather than trusting the number on screen.
    const earnings = await earningsForOrganization(org.id, tx);
    if (amountKobo > toKobo(earnings.available)) {
      throw new PayoutRequestError("That's more than you have available.", 409, {
        available: earnings.available,
      });
    }

    const now = new Date();
    const [created] = await tx
      .insert(payouts)
      .values({
        organizationId: org.id,
        // Account-wide, not tied to one event.
        eventId: null,
        // A snapshot of the SETTLED money the request drew on.
        grossAmount: earnings.settledGross.toFixed(2),
        platformFee: earnings.settledPlatformFee.toFixed(2),
        paymentProcessingFee: earnings.settledProcessingFee.toFixed(2),
        netAmount: (amountKobo / 100).toFixed(2),
        status: "pending",
        bankName: org.bankName,
        bankAccountName: org.bankAccountName,
        bankAccountNumber: org.bankAccountNumber,
        requestedBy: input.userId,
        requestedAt: now,
        availableAtRequest: earnings.available.toFixed(2),
        statusChangedAt: now,
      })
      .returning({ id: payouts.id });

    await tx.insert(payoutEvents).values({
      payoutId: created.id,
      fromStatus: null,
      toStatus: "pending",
      actorId: input.userId,
      createdAt: now,
    });

    return { id: created.id, availableBefore: earnings.available };
  });
}

// ── Admin: act on a request ─────────────────────────────────────────────

export async function applyPayoutAction(input: {
  payoutId: string;
  actorId: string;
  action: ActionInput;
}): Promise<{ id: string; from: PayoutStatus; to: PayoutStatus }> {
  try {
    return await db.transaction(async (tx) => {
      const [payout] = await tx
        .select({ id: payouts.id, status: payouts.status })
        .from(payouts)
        .where(eq(payouts.id, input.payoutId))
        .for("update");
      if (!payout) throw new PayoutRequestError("Payout request not found.", 404);

      const checked = validateAction(payout.status, input.action);
      if (!checked.ok) throw new PayoutRequestError(checked.error, 409, { status: payout.status });
      const { to, organiserNote, historyNote, paymentReference } = checked.value;

      const now = new Date();
      const [updated] = await tx
        .update(payouts)
        .set({
          status: to,
          // What the organiser reads: the rejection reason or failure note,
          // cleared again on approve / retry / paid so a stale reason never
          // sits beside a paid request.
          note: organiserNote,
          statusChangedAt: now,
          ...(to === "paid" ? { paidAt: now, paymentReference } : {}),
        })
        // Belt and braces with the row lock: only from the status we checked.
        .where(and(eq(payouts.id, payout.id), eq(payouts.status, payout.status)))
        .returning({ id: payouts.id });
      if (!updated) {
        throw new PayoutRequestError("This request was just updated by someone else.", 409);
      }

      await tx.insert(payoutEvents).values({
        payoutId: payout.id,
        fromStatus: payout.status,
        toStatus: to,
        actorId: input.actorId,
        note: historyNote,
        paymentReference,
        createdAt: now,
      });

      return { id: payout.id, from: payout.status as PayoutStatus, to };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new PayoutRequestError(
        "That transfer reference is already recorded on another payout.",
        409
      );
    }
    throw error;
  }
}

// ── Admin: read ─────────────────────────────────────────────────────────

const OPEN: PayoutStatus[] = ["pending", "approved", "processing", "failed"];

function personName(u: { firstName: string | null; lastName: string | null; name: string | null } | null) {
  if (!u) return null;
  const joined = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return joined || u.name || null;
}

function balanceView(e: Earnings) {
  return {
    settledNet: e.settledNet,
    unsettledNet: e.unsettledNet,
    paidOut: e.paidOut,
    committed: e.committed,
    available: e.available,
    shortfall: e.shortfall,
  };
}

async function queryRequests(
  where: ReturnType<typeof eq> | undefined,
  order: "oldest" | "newest"
) {
  const rows = await db
    .select({
      id: payouts.id,
      status: payouts.status,
      amount: payouts.netAmount,
      requestedAt: payouts.requestedAt,
      statusChangedAt: payouts.statusChangedAt,
      paidAt: payouts.paidAt,
      bankName: payouts.bankName,
      bankAccountName: payouts.bankAccountName,
      bankAccountNumber: payouts.bankAccountNumber,
      paymentReference: payouts.paymentReference,
      availableAtRequest: payouts.availableAtRequest,
      note: payouts.note,
      organizationId: organizations.id,
      organizationName: organizations.name,
      ownerId: organizations.ownerId,
      requesterFirst: users.firstName,
      requesterLast: users.lastName,
      requesterName: users.name,
      requesterEmail: users.email,
    })
    .from(payouts)
    .innerJoin(organizations, eq(organizations.id, payouts.organizationId))
    .leftJoin(users, eq(users.id, payouts.requestedBy))
    .where(where)
    .orderBy(order === "oldest" ? asc(payouts.requestedAt) : desc(payouts.requestedAt))
    .limit(200);

  const ownerIds = [...new Set(rows.map((r) => r.ownerId))];
  const ownerRows = ownerIds.length
    ? await db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, name: users.name, email: users.email })
        .from(users)
        .where(inArray(users.id, ownerIds))
    : [];
  const ownerById = new Map(ownerRows.map((u) => [u.id, u]));

  // One balance per organisation on the page, from the same function the
  // organiser's own Finance page uses.
  const balances = new Map<string, Earnings>();
  for (const orgId of new Set(rows.map((r) => r.organizationId))) {
    balances.set(orgId, await earningsForOrganization(orgId));
  }

  return rows.map((r) => {
    const balance = balances.get(r.organizationId)!;
    const o = ownerById.get(r.ownerId) ?? null;
    return {
      id: r.id,
      status: r.status,
      amount: Number(r.amount),
      requestedAt: r.requestedAt,
      statusChangedAt: r.statusChangedAt,
      paidAt: r.paidAt,
      organization: { id: r.organizationId, name: r.organizationName },
      owner: o ? { name: personName(o), email: o.email } : null,
      requestedBy: r.requesterEmail
        ? {
            name: personName({ firstName: r.requesterFirst, lastName: r.requesterLast, name: r.requesterName }),
            email: r.requesterEmail,
          }
        : null,
      // Full account number: these functions are only reached through
      // routes that checked payouts.view.
      bank: { name: r.bankName, accountName: r.bankAccountName, accountNumber: r.bankAccountNumber },
      paymentReference: r.paymentReference,
      availableAtRequest: r.availableAtRequest === null ? null : Number(r.availableAtRequest),
      note: r.note,
      balance: balanceView(balance),
      // Open requests at an organisation whose open requests exceed its
      // settled money need a person to look (e.g. made before settlement
      // tracking existed). Never changed automatically.
      needsReview: OPEN.includes(r.status as PayoutStatus) && balance.shortfall > 0,
      allowedActions: allowedActions(r.status),
    };
  });
}

/** How many requests sit in each status. Cheap: for the admin nav badge. */
export async function payoutCounts(): Promise<Record<string, number>> {
  const countRows = await db
    .select({ status: payouts.status, count: sql<number>`count(*)::int` })
    .from(payouts)
    .groupBy(payouts.status);
  const counts: Record<string, number> = {};
  for (const c of countRows) counts[c.status] = Number(c.count);
  return counts;
}

export async function listPayoutRequests(status: PayoutStatus | "all") {
  const requests = await queryRequests(
    status === "all" ? undefined : eq(payouts.status, status),
    // Queues read oldest first (first come, first served); history newest first.
    status === "pending" || status === "approved" || status === "processing" ? "oldest" : "newest"
  );
  return { counts: await payoutCounts(), requests };
}

export async function getPayoutRequest(id: string) {
  const [request] = await queryRequests(eq(payouts.id, id), "newest");
  if (!request) return null;

  const orgEvents = await db
    .select({ id: events.id, title: events.title, startDatetime: events.startDatetime, status: events.status })
    .from(events)
    .where(eq(events.organizationId, request.organization.id))
    .orderBy(desc(events.startDatetime));
  const eventRows = [];
  for (const event of orgEvents) {
    const e = await earningsForEvent(event.id);
    if (e.ticketsSold === 0 && e.netEarned === 0) continue;
    eventRows.push({
      id: event.id,
      title: event.title,
      startsAt: event.startDatetime,
      status: event.status,
      ticketsSold: e.ticketsSold,
      netEarned: e.netEarned,
      settledNet: e.settledNet,
      unsettledNet: e.unsettledNet,
    });
  }

  const history = await db
    .select({
      id: payoutEvents.id,
      fromStatus: payoutEvents.fromStatus,
      toStatus: payoutEvents.toStatus,
      note: payoutEvents.note,
      paymentReference: payoutEvents.paymentReference,
      createdAt: payoutEvents.createdAt,
      actorFirst: users.firstName,
      actorLast: users.lastName,
      actorName: users.name,
      actorEmail: users.email,
    })
    .from(payoutEvents)
    .leftJoin(users, eq(users.id, payoutEvents.actorId))
    .where(eq(payoutEvents.payoutId, id))
    .orderBy(asc(payoutEvents.createdAt));

  return {
    ...request,
    events: eventRows,
    history: history.map((h) => ({
      id: h.id,
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      note: h.note,
      paymentReference: h.paymentReference,
      createdAt: h.createdAt,
      actor: h.actorEmail
        ? { name: personName({ firstName: h.actorFirst, lastName: h.actorLast, name: h.actorName }), email: h.actorEmail }
        : null,
    })),
  };
}
