import { eq } from "drizzle-orm";
import { db } from "@/db";
import { payments } from "@/db/schema";
import {
  failPendingOrder,
  finalizePaidOrder,
  type FinalizeResult,
} from "@/lib/finalize-order";
type PaystackEnvelope<T> = {
  status: true;
  message?: string;
  data: T;
};

type PaystackCheckout = {
  authorization_url: string;
  access_code: string;
  reference: string;
};

export type PaystackTransaction = {
  reference: string;
  status: string;
  amount: number | string;
  currency: string;
  fees?: number | string | null;
};

export function matchesPaystackAmount(
  transaction: Pick<PaystackTransaction, "amount" | "currency" | "fees">,
  expectedAmount: number
): boolean {
  const amountMinor = Number(transaction.amount);
  const expectedAmountMinor = Math.round(expectedAmount * 100);
  const feeMinor =
    transaction.fees === null || transaction.fees === undefined
      ? null
      : Number(transaction.fees);
  const includesBuyerFee =
    feeMinor !== null &&
    Number.isSafeInteger(feeMinor) &&
    feeMinor >= 0 &&
    amountMinor === expectedAmountMinor + feeMinor;
  return (
    transaction.currency === "NGN" &&
    Number.isSafeInteger(amountMinor) &&
    (amountMinor === expectedAmountMinor || includesBuyerFee)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function secretKey(): string {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) {
    throw new Error("Paystack is not configured. Set PAYSTACK_SECRET_KEY.");
  }
  return secret;
}

async function paystackRequest<T>(
  path: string,
  init: RequestInit
): Promise<PaystackEnvelope<T>> {
  const response = await fetch(`https://api.paystack.co${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Paystack returned an invalid JSON response.");
  }
  if (
    !response.ok ||
    !isRecord(body) ||
    body.status !== true ||
    !isRecord(body.data)
  ) {
    const message =
      isRecord(body) && typeof body.message === "string"
        ? body.message
        : response.statusText;
    throw new Error(
      `Paystack request failed${message ? `: ${message}` : ""}`
    );
  }
  return body as PaystackEnvelope<T>;
}

function isPaystackCheckout(value: unknown): value is PaystackCheckout {
  if (!isRecord(value)) return false;
  if (
    typeof value.authorization_url !== "string" ||
    typeof value.access_code !== "string" ||
    typeof value.reference !== "string"
  ) {
    return false;
  }
  try {
    const url = new URL(value.authorization_url);
    return url.protocol === "https:" && url.hostname === "checkout.paystack.com";
  } catch {
    return false;
  }
}

export async function initializePaystackCheckout(input: {
  amount: number;
  email: string;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, string | number>;
}): Promise<{
  checkout: PaystackCheckout;
  raw: PaystackEnvelope<PaystackCheckout>;
}> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Paystack checkout amount must be greater than zero.");
  }
  const amountMinor = Math.round(input.amount * 100);
  if (!Number.isSafeInteger(amountMinor)) {
    throw new Error("Paystack checkout amount is invalid.");
  }

  const raw = await paystackRequest<PaystackCheckout>(
    "/transaction/initialize",
    {
      method: "POST",
      body: JSON.stringify({
        amount: amountMinor,
        email: input.email,
        reference: input.reference,
        callback_url: input.callbackUrl,
        metadata: input.metadata,
      }),
    }
  );
  if (
    !isPaystackCheckout(raw.data) ||
    raw.data.reference !== input.reference
  ) {
    throw new Error("Paystack returned an invalid checkout response.");
  }
  return { checkout: raw.data, raw };
}

export async function verifyPaystackTransaction(
  reference: string
): Promise<PaystackEnvelope<PaystackTransaction>> {
  return paystackRequest<PaystackTransaction>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
    { method: "GET" }
  );
}

export type PaystackPaymentResult =
  | { status: "paid"; result: FinalizeResult }
  | { status: "pending"; orderId: string }
  | { status: "failed"; result: FinalizeResult }
  | { status: "unknown" };

export async function verifyAndFinalizePaystackPayment(
  reference: string
): Promise<PaystackPaymentResult> {
  const payment = await db.query.payments.findFirst({
    where: eq(payments.providerReference, reference),
    with: { order: true },
  });
  if (!payment || payment.provider !== "paystack" || !payment.order) {
    return { status: "unknown" };
  }

  if (payment.status === "success") {
    return {
      status: "paid",
      result: {
        ok: true,
        orderId: payment.order.id,
        alreadyDone: true,
        emailSent: false,
      },
    };
  }

  const raw = await verifyPaystackTransaction(reference);
  const transaction = raw.data;
  if (transaction.reference !== reference) {
    throw new Error(`Paystack returned a different reference for ${reference}.`);
  }

  if (transaction.status === "success") {
    if (!matchesPaystackAmount(transaction, Number(payment.amount))) {
      throw new Error(`Paystack transaction did not match order ${reference}.`);
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
    return { status: "paid", result: await finalizePaidOrder(reference) };
  }

  if (transaction.status === "failed") {
    return {
      status: "failed",
      result: await failPendingOrder(reference),
    };
  }

  return { status: "pending", orderId: payment.order.id };
}

export function paystackFeeFromStoredResponse(raw: unknown): number | null {
  if (!isRecord(raw)) return null;
  const verification = raw.verification;
  const response =
    isRecord(verification) && isRecord(verification.data)
      ? verification.data
      : isRecord(raw.data)
        ? raw.data
        : null;
  if (!response || response.fees === null || response.fees === undefined) {
    return null;
  }
  const feeMinor = Number(response.fees);
  return Number.isFinite(feeMinor) && feeMinor >= 0
    ? Math.round(feeMinor) / 100
    : null;
}
