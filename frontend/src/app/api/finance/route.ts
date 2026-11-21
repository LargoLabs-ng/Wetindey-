import { after, NextRequest, NextResponse } from "next/server";
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
import { createWithdrawalRequest, PayoutRequestError } from "@/lib/payout-requests";
import { notifyAdminsOfPayoutRequest, notifyBankDetailsChanged } from "@/lib/payout-emails";

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
        paymentReference: payouts.paymentReference,
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
      paymentReference: h.paymentReference,
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
    const bank = parsed.data;
    const [before] = await db
      .select({ bankName: organizations.bankName, accountNumber: organizations.bankAccountNumber, accountName: organizations.bankAccountName })
      .from(organizations)
      .where(eq(organizations.id, auth.organizationId))
      .limit(1);

    await db
      .update(organizations)
      .set({
        bankName: parsed.data.bankName,
        bankAccountName: parsed.data.accountName,
        bankAccountNumber: parsed.data.accountNumber,
      })
      .where(eq(organizations.id, auth.organizationId));

    // Tell the owner whenever the payout account changes — the one change a
    // stolen login would make first. Sent after the response; a failed email
    // never undoes the save.
    const changed =
      !before ||
      before.bankName !== bank.bankName ||
      before.accountName !== bank.accountName ||
      before.accountNumber !== bank.accountNumber;
    if (changed) {
      after(() =>
        notifyBankDetailsChanged({
          organizationId: auth.organizationId,
          before: before?.accountNumber ? { bankName: before.bankName, accountNumber: before.accountNumber } : null,
          after: {
            bankName: bank.bankName,
            accountName: bank.accountName,
            accountNumber: bank.accountNumber,
          },
        })
      );
    }

    return NextResponse.json({ ok: true });
  }

  // ── A withdrawal request ──────────────────────────────────────────────
  // Checked and saved under a lock on the organisation (lib/payout-requests),
  // so two requests sent at once cannot overspend between them, and the
  // balance is recomputed there rather than trusted from the screen. Only
  // money Paystack has settled to Wetin Dey counts.
  try {
    const created = await createWithdrawalRequest({
      organizationId: auth.organizationId,
      userId: auth.userId,
      amount: parsed.data.amount,
    });
    after(() => notifyAdminsOfPayoutRequest(created.id));
    return NextResponse.json({ ok: true, id: created.id });
  } catch (error) {
    if (error instanceof PayoutRequestError) {
      return NextResponse.json({ error: error.message, ...error.extra }, { status: error.status });
    }
    console.error("Withdrawal request failed:", error);
    return NextResponse.json({ error: "That didn't work. Nothing was requested." }, { status: 500 });
  }
}
