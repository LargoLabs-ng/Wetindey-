import { describe, expect, it } from "vitest";
import { fetchSuccessfulSettlements } from "./paystack-settlements-api";

type Call = { url: URL; method: string; auth: string | undefined };

/** A fake Paystack that serves canned pages and records every request. */
function fakePaystack(routes: Record<string, unknown[][]>) {
  const calls: Call[] = [];
  const fetchImpl = async (input: string, init: { method: "GET"; headers: Record<string, string> }) => {
    const url = new URL(input);
    calls.push({ url, method: init.method, auth: init.headers.Authorization });
    const pages = routes[url.pathname];
    if (!pages) return { ok: false, status: 404, json: async () => ({ status: false, message: "Not found" }) };
    const page = Number(url.searchParams.get("page") ?? "1");
    const data = pages[page - 1] ?? [];
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: true, data, meta: { page, pageCount: pages.length } }),
    };
  };
  return { calls, fetchImpl };
}

describe("fetchSuccessfulSettlements", () => {
  it("reads every page of settlements and of each settlement's transactions", async () => {
    const { calls, fetchImpl } = fakePaystack({
      "/settlement": [
        [{ id: 101, status: "success", settlement_date: "2026-11-09T00:00:00.000Z" }],
        [{ id: "102", status: "success", settlement_date: "2026-11-10T00:00:00.000Z" }],
      ],
      "/settlement/101/transactions": [
        [{ reference: "WD-1", amount: 500000, fees: null, currency: "NGN", status: "success" }],
        [{ reference: "WD-2", amount: "250000", fees: "3750", currency: "NGN", status: "success" }],
      ],
      "/settlement/102/transactions": [[]],
    });

    const { settlements, unusable } = await fetchSuccessfulSettlements({
      secretKey: "sk_test_x",
      from: "2026-11-01",
      perPage: 1,
      fetchImpl,
    });

    expect(unusable).toBe(0);
    expect(settlements.map((s) => s.id)).toEqual(["101", "102"]);
    expect(settlements[0].settledAt.toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(settlements[0].transactions).toEqual([
      { reference: "WD-1", amountMinor: 500000, feesMinor: null, currency: "NGN", status: "success" },
      { reference: "WD-2", amountMinor: 250000, feesMinor: 3750, currency: "NGN", status: "success" },
    ]);

    // Read-only, authenticated, successful main-account settlements only.
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(calls.every((c) => c.auth === "Bearer sk_test_x")).toBe(true);
    const list = calls.find((c) => c.url.pathname === "/settlement");
    expect(list?.url.searchParams.get("status")).toBe("success");
    expect(list?.url.searchParams.get("subaccount")).toBe("none");
    expect(list?.url.searchParams.get("from")).toBe("2026-11-01");
  });

  it("skips settlements without an id or a date instead of guessing", async () => {
    const { fetchImpl } = fakePaystack({
      "/settlement": [[{ id: 7, status: "success" }, { status: "success", settlement_date: "2026-11-09" }]],
    });
    const result = await fetchSuccessfulSettlements({ secretKey: "k", fetchImpl });
    expect(result.settlements).toHaveLength(0);
    expect(result.unusable).toBe(2);
  });

  it("throws when Paystack reports an error", async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ status: false, message: "Invalid key" }),
    });
    await expect(fetchSuccessfulSettlements({ secretKey: "bad", fetchImpl })).rejects.toThrow(
      /Invalid key/
    );
  });

  it("stops at the page limit rather than looping forever", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      // A broken API that always claims there is another full page.
      json: async () => ({ status: true, data: [{ id: 1, status: "success", settlement_date: "2026-11-09" }], meta: {} }),
    });
    await expect(
      fetchSuccessfulSettlements({ secretKey: "k", fetchImpl, perPage: 1, maxPages: 3 })
    ).rejects.toThrow(/Stopped after 3 pages/);
  });
});
