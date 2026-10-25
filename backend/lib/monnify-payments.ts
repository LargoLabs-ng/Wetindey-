import { eq } from "drizzle-orm";
import { db } from "@/db";
import { payments } from "@/db/schema";
import {
  failPendingOrder,
  finalizePaidOrder,
  type FinalizeResult,
} from "@/lib/finalize-order";
import {
  storedMonnifyInitialization,
  verifyMonnifyTransaction,
  type MonnifyTransaction,
} from "@/lib/monnify";

const round2 = (value: number) => Math.round(value * 100) / 100;

export type MonnifyPaymentResult =
  | { status: "paid"; result: FinalizeResult }
  | { status: "pending"; orderId: string }
  | { status: "failed"; result: FinalizeResult }
  | { status: "unknown" };

function validPaidTransaction(
  transaction: MonnifyTransaction,
  input: {
    paymentReference: string;
    expectedAmount: number;
    expectedTransactionReference: string | null;
  }
): boolean {
  const amountPaid = Number(transaction.amountPaid);
  const fee = Number(transaction.fee);
  const settlement = Number(transaction.settlementAmount);
  return (
    transaction.paymentStatus === "PAID" &&
    transaction.paymentReference === input.paymentReference &&
    Boolean(transaction.transactionReference) &&
    (!input.expectedTransactionReference ||
      transaction.transactionReference === input.expectedTransactionReference) &&
    transaction.currencyCode === "NGN" &&
    Number.isFinite(amountPaid) &&
    round2(amountPaid) === round2(input.expectedAmount) &&
    Number.isFinite(fee) &&
    fee >= 0 &&
    Number.isFinite(settlement) &&
    settlement >= 0 &&
    round2(settlement + fee) === round2(amountPaid)
  );
}

export async function verifyAndFinalizeMonnifyPayment(
  paymentReference: string
): Promise<MonnifyPaymentResult> {
  const payment = await db.query.payments.findFirst({
    where: eq(payments.providerReference, paymentReference),
    with: { order: true },
  });

  if (!payment || payment.provider !== "monnify" || !payment.order) {
    return { status: "unknown" };
  }

  const { transaction, raw } =
    await verifyMonnifyTransaction(paymentReference);

  if (transaction.paymentReference !== paymentReference) {
    throw new Error(
      `Monnify returned a different payment reference for ${paymentReference}.`
    );
  }

  if (transaction.paymentStatus === "PAID") {
    const initialized = storedMonnifyInitialization(payment.rawProviderResponse);
    const valid = validPaidTransaction(transaction, {
      paymentReference,
      expectedAmount: Number(payment.amount),
      expectedTransactionReference: initialized?.transactionReference ?? null,
    });

    if (!valid) {
      throw new Error(
        `Monnify transaction did not match the order for ${paymentReference}.`
      );
    }

    await db
      .update(payments)
      .set({
        rawProviderResponse: {
          initialization: payment.rawProviderResponse,
          verification: raw,
        },
      })
      .where(eq(payments.id, payment.id));

    const result = await finalizePaidOrder(paymentReference);
    return { status: "paid", result };
  }

  if (
    transaction.paymentStatus === "FAILED" ||
    transaction.paymentStatus === "EXPIRED" ||
    transaction.paymentStatus === "REJECTED"
  ) {
    return {
      status: "failed",
      result: await failPendingOrder(paymentReference),
    };
  }

  return { status: "pending", orderId: payment.order.id };
}
