import { NextResponse } from "next/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { payments } from "@/db/schema";
import { getSessionUserId, isPlatformAdmin } from "@/lib/authz";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export async function GET() {
  if (!(await isPlatformAdmin())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const rows = await db.query.payments.findMany({
      where: and(
        eq(payments.manualReviewRequired, true),
        isNull(payments.manualReviewResolvedAt)
      ),
      with: {
        order: {
          with: {
            event: true,
            tickets: true,
          },
        },
      },
      orderBy: asc(payments.paidAt),
    });
    return NextResponse.json({
      reviews: rows.map((payment) => {
        const verification = record(record(payment.rawProviderResponse)?.verification);
        const verifiedData = record(verification?.data);
        const providerAmountMinor =
          verifiedData?.amount === null || verifiedData?.amount === undefined
            ? NaN
            : Number(verifiedData.amount);
        const providerFeeMinor =
          verifiedData?.fees === null || verifiedData?.fees === undefined
            ? NaN
            : Number(verifiedData.fees);
        return {
          id: payment.id,
          reference: payment.providerReference,
          amount: payment.amount,
          providerAmount: Number.isSafeInteger(providerAmountMinor)
            ? providerAmountMinor / 100
            : null,
          providerFee: Number.isSafeInteger(providerFeeMinor)
            ? providerFeeMinor / 100
            : null,
          reason: payment.manualReviewReason,
          paidAt: payment.paidAt,
          note: payment.manualReviewNote,
          order: {
            id: payment.order.id,
            email: payment.order.email,
            total: payment.order.total,
            ticketUnitPrice: payment.order.ticketUnitPrice,
            eventTitle: payment.order.event.title,
            tickets: payment.order.tickets.length,
          },
        };
      }),
    });
  } catch (error) {
    console.error("Could not load payment reviews:", error);
    return NextResponse.json({ error: "Could not load payment reviews." }, { status: 500 });
  }
}

const resolveSchema = z.object({
  paymentId: z.string().uuid(),
  note: z.string().trim().min(10).max(1000),
});

export async function PATCH(request: Request) {
  if (!(await isPlatformAdmin())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const parsed = resolveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide a review note of at least 10 characters." },
      { status: 400 }
    );
  }

  try {
    const [updated] = await db
      .update(payments)
      .set({
        manualReviewResolvedAt: new Date(),
        manualReviewResolvedBy: userId,
        manualReviewNote: parsed.data.note,
      })
      .where(
        and(
          eq(payments.id, parsed.data.paymentId),
          eq(payments.manualReviewRequired, true),
          isNull(payments.manualReviewResolvedAt)
        )
      )
      .returning({ id: payments.id });

    if (!updated) {
      return NextResponse.json({ error: "Review not found or already resolved." }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Could not resolve payment review:", error);
    return NextResponse.json({ error: "Could not resolve payment review." }, { status: 500 });
  }
}
