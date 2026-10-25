import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initializeMonnifyCheckout,
  isMonnifyWebhookSignatureValid,
  monnifyFeeFromStoredResponse,
  storedMonnifyTransaction,
} from "./monnify";

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let apiKeyIndex = 0;

beforeEach(() => {
  apiKeyIndex += 1;
  vi.stubEnv("MONNIFY_API_KEY", `test-key-${apiKeyIndex}`);
  vi.stubEnv("MONNIFY_SECRET_KEY", "test-secret");
  vi.stubEnv("MONNIFY_CONTRACT_CODE", "test-contract");
  vi.stubEnv("MONNIFY_ENV", "sandbox");
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("initializeMonnifyCheckout", () => {
  it("authenticates and returns a matching sandbox checkout", async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          requestSuccessful: true,
          responseBody: { accessToken: "access-token" },
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          requestSuccessful: true,
          responseBody: {
            transactionReference: "transaction-ref",
            paymentReference: "merchant-ref",
            checkoutUrl: "https://sandbox.sdk.monnify.com/checkout/transaction-ref",
          },
        })
      );

    const result = await initializeMonnifyCheckout({
      amount: 5000,
      email: "buyer@example.test",
      customerName: "Test Buyer",
      paymentReference: "merchant-ref",
      paymentDescription: "Event tickets",
      redirectUrl: "https://example.test/payment/callback?reference=merchant-ref",
      metadata: { orderId: "order-id", ticketCount: 2 },
    });

    expect(result.transaction.paymentReference).toBe("merchant-ref");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, request] = fetchMock.mock.calls[1];
    expect(url).toBe(
      "https://sandbox.monnify.com/api/v1/merchant/transactions/init-transaction"
    );
    expect(new Headers(request?.headers).get("Authorization")).toBe(
      "Bearer access-token"
    );
    expect(JSON.parse(String(request?.body))).toMatchObject({
      amount: 5000,
      currencyCode: "NGN",
      contractCode: "test-contract",
      customerEmail: "buyer@example.test",
      paymentReference: "merchant-ref",
    });
  });

  it("rejects an unexpected checkout host", async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          requestSuccessful: true,
          responseBody: { accessToken: "access-token" },
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          requestSuccessful: true,
          responseBody: {
            transactionReference: "transaction-ref",
            paymentReference: "merchant-ref",
            checkoutUrl: "https://attacker.example/checkout",
          },
        })
      );

    await expect(
      initializeMonnifyCheckout({
        amount: 5000,
        email: "buyer@example.test",
        customerName: "Test Buyer",
        paymentReference: "merchant-ref",
        paymentDescription: "Event tickets",
        redirectUrl: "https://example.test/callback",
        metadata: {},
      })
    ).rejects.toThrow("invalid checkout response");
  });
});

describe("Monnify webhook signatures and stored transactions", () => {
  it("validates HMAC-SHA512 signatures", () => {
    const body = '{"eventType":"SUCCESSFUL_TRANSACTION"}';
    const signature = createHmac("sha512", "webhook-secret")
      .update(body)
      .digest("hex");

    expect(
      isMonnifyWebhookSignatureValid(body, signature, "webhook-secret")
    ).toBe(true);
    expect(
      isMonnifyWebhookSignatureValid(body, signature, "wrong-secret")
    ).toBe(false);
  });

  it("reads verified fee data from the stored provider response", () => {
    const raw = {
      initialization: { responseBody: { transactionReference: "transaction-ref" } },
      verification: {
        responseBody: {
          transactionReference: "transaction-ref",
          paymentReference: "merchant-ref",
          paymentStatus: "PAID",
          amountPaid: 5000,
          settlementAmount: 4825,
          fee: 175,
          currencyCode: "NGN",
          paymentMethod: "ACCOUNT_TRANSFER",
        },
      },
    };

    expect(storedMonnifyTransaction(raw)?.paymentStatus).toBe("PAID");
    expect(monnifyFeeFromStoredResponse(raw)).toBe(175);
    expect(monnifyFeeFromStoredResponse(null)).toBeNull();
  });
});
