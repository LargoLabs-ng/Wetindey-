import { createHmac, timingSafeEqual } from "node:crypto";

type MonnifyResponse<T> = {
  requestSuccessful: boolean;
  responseMessage?: string;
  responseCode?: string;
  responseBody: T;
};

export type MonnifyTransaction = {
  transactionReference: string;
  paymentReference: string;
  paymentStatus: string;
  amountPaid: number | string;
  totalPayable?: number | string;
  settlementAmount: number | string;
  fee: number | string;
  currencyCode: string;
  paymentMethod: string;
};

export type MonnifyRefund = {
  refundReference: string;
  transactionReference: string;
  refundAmount: number | string;
  refundStatus: "PENDING" | "COMPLETED" | "FAILED" | string;
};

type CheckoutResponse = {
  transactionReference: string;
  paymentReference: string;
  checkoutUrl: string;
};

type TokenCache = {
  apiKey: string;
  baseUrl: string;
  accessToken: string;
  expiresAt: number;
};

let tokenCache: TokenCache | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEnvironment(value: string): value is "sandbox" | "production" {
  return value === "sandbox" || value === "production";
}

export class MonnifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly providerRejected: boolean
  ) {
    super(message);
    this.name = "MonnifyError";
  }
}

function configuration() {
  const apiKey = process.env.MONNIFY_API_KEY;
  const secretKey = process.env.MONNIFY_SECRET_KEY;
  const contractCode = process.env.MONNIFY_CONTRACT_CODE;
  if (!apiKey || !secretKey || !contractCode) {
    throw new Error(
      "Monnify is not configured. Set MONNIFY_API_KEY, MONNIFY_SECRET_KEY, and MONNIFY_CONTRACT_CODE."
    );
  }

  const environment = process.env.MONNIFY_ENV ?? "sandbox";
  if (!isEnvironment(environment)) {
    throw new Error("MONNIFY_ENV must be either sandbox or production.");
  }
  const baseUrl =
    environment === "production"
      ? "https://api.monnify.com"
      : "https://sandbox.monnify.com";
  return { apiKey, secretKey, contractCode, baseUrl, environment };
}

async function readResponse<T>(
  response: Response
): Promise<MonnifyResponse<T>> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new MonnifyError(
      "Monnify returned an invalid JSON response.",
      response.status,
      false
    );
  }
  if (
    !response.ok ||
    !isRecord(body) ||
    !("requestSuccessful" in body) ||
    body.requestSuccessful !== true ||
    !isRecord(body.responseBody)
  ) {
    const details =
      isRecord(body) && "responseMessage" in body
        ? String(body.responseMessage)
        : response.statusText;
    throw new MonnifyError(
      `Monnify request failed${details ? `: ${details}` : ""}`,
      response.status,
      response.ok
    );
  }
  return body as MonnifyResponse<T>;
}

async function accessToken(): Promise<string> {
  const { apiKey, secretKey, baseUrl } = configuration();
  const now = Date.now();
  if (
    tokenCache?.apiKey === apiKey &&
    tokenCache.baseUrl === baseUrl &&
    tokenCache.expiresAt > now + 60_000
  ) {
    return tokenCache.accessToken;
  }

  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: "{}",
    cache: "no-store",
  });
  const result = await readResponse<{ accessToken: string }>(response);
  if (typeof result.responseBody.accessToken !== "string") {
    throw new MonnifyError("Monnify returned no access token.", response.status, false);
  }

  tokenCache = {
    apiKey,
    baseUrl,
    accessToken: result.responseBody.accessToken,
    // Monnify documents a one-hour token lifetime.
    expiresAt: now + 55 * 60_000,
  };
  return tokenCache.accessToken;
}

async function authorizedRequest<T>(
  path: string,
  init: RequestInit
): Promise<MonnifyResponse<T>> {
  const { baseUrl } = configuration();
  const token = await accessToken();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  return readResponse<T>(response);
}

function validCheckoutUrl(url: string, environment: "sandbox" | "production"): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname ===
        (environment === "production"
          ? "sdk.monnify.com"
          : "sandbox.sdk.monnify.com")
    );
  } catch {
    return false;
  }
}

export async function initializeMonnifyCheckout(input: {
  amount: number;
  email: string;
  customerName: string;
  paymentReference: string;
  paymentDescription: string;
  redirectUrl: string;
  metadata: Record<string, string | number>;
}): Promise<{
  transaction: CheckoutResponse;
  raw: MonnifyResponse<CheckoutResponse>;
}> {
  const { contractCode, environment } = configuration();
  const result = await authorizedRequest<CheckoutResponse>(
    "/api/v1/merchant/transactions/init-transaction",
    {
      method: "POST",
      body: JSON.stringify({
        amount: input.amount,
        currencyCode: "NGN",
        contractCode,
        customerEmail: input.email,
        customerName: input.customerName,
        paymentReference: input.paymentReference,
        paymentDescription: input.paymentDescription,
        redirectUrl: input.redirectUrl,
        metadata: input.metadata,
        paymentMethods: ["CARD", "ACCOUNT_TRANSFER", "USSD", "PHONE_NUMBER"],
      }),
    }
  );

  const transaction = result.responseBody;
  if (
    !isRecord(transaction) ||
    transaction.paymentReference !== input.paymentReference ||
    typeof transaction.transactionReference !== "string" ||
    typeof transaction.checkoutUrl !== "string" ||
    !validCheckoutUrl(transaction.checkoutUrl, environment)
  ) {
    throw new MonnifyError(
      "Monnify returned an invalid checkout response.",
      502,
      false
    );
  }
  return { transaction, raw: result };
}

export async function verifyMonnifyTransaction(
  paymentReference: string
): Promise<{
  transaction: MonnifyTransaction;
  raw: MonnifyResponse<MonnifyTransaction>;
}> {
  const result = await authorizedRequest<MonnifyTransaction>(
    `/api/v2/merchant/transactions/query?paymentReference=${encodeURIComponent(paymentReference)}`,
    { method: "GET" }
  );
  return { transaction: result.responseBody, raw: result };
}

export async function initiateMonnifyRefund(input: {
  transactionReference: string;
  refundReference: string;
  refundAmount: number;
  refundReason: string;
  customerNote: string;
}): Promise<{ refund: MonnifyRefund; raw: MonnifyResponse<MonnifyRefund> }> {
  const result = await authorizedRequest<MonnifyRefund>(
    "/api/v1/refunds/initiate-refund",
    { method: "POST", body: JSON.stringify(input) }
  );
  return { refund: result.responseBody, raw: result };
}

export function isMonnifyWebhookSignatureValid(
  body: string,
  signature: string,
  secret: string
): boolean {
  const expected = Buffer.from(
    createHmac("sha512", secret).update(body).digest("hex"),
    "utf8"
  );
  const received = Buffer.from(signature, "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function storedMonnifyTransaction(raw: unknown): MonnifyTransaction | null {
  if (!raw || typeof raw !== "object") return null;
  const container = raw as Record<string, unknown>;
  const verification = container.verification;
  const source =
    verification && typeof verification === "object"
      ? (verification as Record<string, unknown>).responseBody
      : container.responseBody;
  if (!source || typeof source !== "object") return null;
  return source as MonnifyTransaction;
}

export function storedMonnifyInitialization(raw: unknown): CheckoutResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const container = raw as Record<string, unknown>;
  const initialization = container.initialization;
  const source =
    initialization && typeof initialization === "object"
      ? (initialization as Record<string, unknown>).responseBody
      : container.responseBody;
  if (!source || typeof source !== "object") return null;
  return source as CheckoutResponse;
}

export function monnifyFeeFromStoredResponse(raw: unknown): number | null {
  const transaction = storedMonnifyTransaction(raw);
  if (!transaction) return null;
  const fee = Number(transaction.fee);
  return Number.isFinite(fee) && fee >= 0 ? fee : null;
}
