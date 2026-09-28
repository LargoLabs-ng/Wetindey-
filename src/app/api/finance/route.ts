import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { organizations, payouts } from "@/db/schema";
import {
  getMembership,
  getPrimaryOrganizationId,
  getSessionUserId,
} from "@/lib/authz";
import { earningsForOrganization } from "@/lib/earnings";

/**
 * The organisation's money.
 *
 * Account-level rather than per-event, because "how much can I withdraw" is
 * not a question about one event — and the per-event payout page we already
 * had could never answer it.
 *
 * Gated on org ownership, not on a per-event capability. Withdrawing is the
 * organisation's decision about the organisation's bank account; somebody
 * staffed onto one event, however senior, has no business there.
 */
async function requireOwner() {
  const userId = await getSessionUserId();
  if (!userId) return { ok: false as const, status: 401, error: "Sign in first." };

  const organizationId = await getPrimaryOrganizationId(userId);
  if (!organizationId) {
    return { ok: false as const, status: 404, error: "No organisation found." };
  }

  const membership = await getMembership(userId, organizationId);
  if (!membership || membership.role !== "owner") {
    return {
      ok: false as const,
      status: 403,
      error: "Only the account owner can manage payouts.",
    };
  }

  return { ok: true as const, userId, organizationId };
}

export async function GET() {
  const auth = await requireOwner();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const [org] = await db
    .select({
      bankName: organizations.bankName,
      bankAccountName: organizations.bankAccountName,
      bankAccountNumber: organizations.bankAccountNumber,
    })
    .from(organizations)
    .where(eq(organizations.id, auth.organizationId))
    .limit(1);

  const [earnings, history] = await Promise.all([
    earningsForOrganization(auth.organizationId),
    db
      .select({
        id: payouts.id,
        netAmount: payouts.netAmount,
        status: payouts.status,
        requestedAt: payouts.requestedAt,
        paidAt: payouts.paidAt,
        note: payouts.note,
        bankName: payouts.bankName,
        bankAccountNumber: payouts.bankAccountNumber,
      })
      .from(payouts)
      .where(eq(payouts.organizationId, auth.organizationId))
      .orderBy(desc(payouts.requestedAt))
      .limit(50),
  ]);

  return NextResponse.json({
    earnings,
    bank: {
      name: org?.bankName ?? "",
      accountName: org?.bankAccountName ?? "",
      // Last four only. The full number goes in when they set it and is not
      // read back out: a payout page left open on a shared library computer
      // should not be a way to copy somebody's account number.
      accountNumberLast4: org?.bankAccountNumber
        ? org.bankAccountNumber.slice(-4)
        : "",
      set: Boolean(org?.bankAccountNumber),
    },
    history: history.map((h) => ({
      id: h.id,
      amount: Number(h.netAmount),
      status: h.status,
      requestedAt: h.requestedAt,
      paidAt: h.paidAt,
      note: h.note,
      bankName: h.bankName,
      accountNumberLast4: h.bankAccountNumber
        ? h.bankAccountNumber.slice(-4)
        : "",
    })),
  });
}

const bankSchema = z.object({
  action: z.literal("bank"),
  bankName: z.string().trim().min(2).max(120),
  accountName: z.string().trim().min(2).max(200),
  // Digits only, 10 for a Nigerian NUBAN, but the length is not enforced:
  // refusing to save a number we merely dislike would leave an organiser
  // unable to request a payout at all, and a wrong number is caught by the
  // transfer failing rather than by us.
  accountNumber: z.string().trim().regex(/^\d{6,20}$/, "Digits only."),
});

const withdrawSchema = z.object({
  action: z.literal("withdraw"),
  amount: z.number().positive(),
});

export async function POST(request: NextRequest) {
  const auth = await requireOwner();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json().catch(() => null);
  const parsed = z
    .discriminatedUnion("action", [bankSchema, withdrawSchema])
    .safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the details." },
      { status: 400 }
    );
  }

  if (parsed.data.action === "bank") {
    await db
      .update(organizations)
      .set({
        bankName: parsed.data.bankName,
        bankAccountName: parsed.data.accountName,
        bankAccountNumber: parsed.data.accountNumber,
      })
      .where(eq(organizations.id, auth.organizationId));

    return NextResponse.json({ ok: true });
  }

  // ── A withdrawal request ──────────────────────────────────────────────
  const [org] = await db
    .select({
      bankName: organizations.bankName,
      bankAccountName: organizations.bankAccountName,
      bankAccountNumber: organizations.bankAccountNumber,
    })
    .from(organizations)
    .where(eq(organizations.id, auth.organizationId))
    .limit(1);

  if (!org?.bankAccountNumber) {
    return NextResponse.json(
      { error: "Add your bank account before requesting a payout." },
      { status: 400 }
    );
  }

  // Recomputed here rather than trusting the number the page was showing.
  // A tab left open for an hour, or a refund issued in between, and the
  // figure on screen is no longer the figure that is owed.
  const earnings = await earningsForOrganization(auth.organizationId);

  if (parsed.data.amount > earnings.available + 0.01) {
    return NextResponse.json(
      {
        error: "That's more than you have available.",
        available: earnings.available,
      },
      { status: 409 }
    );
  }

  const [created] = await db
    .insert(payouts)
    .values({
      organizationId: auth.organizationId,
      // Account-wide, not tied to one event: the balance it draws on is the
      // whole organisation's.
      eventId: null,
      grossAmount: earnings.grossSales.toFixed(2),
      platformFee: earnings.platformFee.toFixed(2),
      paymentProcessingFee: earnings.processingFee.toFixed(2),
      netAmount: parsed.data.amount.toFixed(2),
      status: "pending",
      bankName: org.bankName,
      bankAccountName: org.bankAccountName,
      bankAccountNumber: org.bankAccountNumber,
      requestedBy: auth.userId,
    })
    .returning({ id: payouts.id });

  return NextResponse.json({ ok: true, id: created.id });
}
