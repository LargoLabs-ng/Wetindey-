/**
 * A read-only client for Paystack's Settlements API.
 *
 *   GET /settlement?status=success      the batches Paystack paid to us
 *   GET /settlement/:id/transactions    the transactions inside one batch
 *
 * Its own file, not lib/paystack.ts: that module's request helper only
 * accepts an object in `data`, and these endpoints return lists. Keeping it
 * apart also means the Phase 1 branch, which edits paystack.ts, does not
 * collide with this work.
 *
 * Nothing but a type import, and `fetch` can be swapped: the command-line dry run and the
 * tests use this file without the app around it. It only ever sends GET.
 */
import type {
  ProviderSettlement,
  ProviderSettlementTransaction,
} from "./settlement-reconcile";

type FetchLike = (
  url: string,
  init: { method: "GET"; headers: Record<string, string> }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type SettlementApiOptions = {
  secretKey: string;
  /** ISO date or timestamp; only settlements from this point on. */
  from?: string;
  to?: string;
  /** Records per page; Paystack defaults to 50. */
  perPage?: number;
  /** Hard stop so a paging bug can never loop forever. */
  maxPages?: number;
  fetchImpl?: FetchLike;
  baseUrl?: string;
};

const BASE_URL = "https://api.paystack.co";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toInt(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : NaN;
}

async function getPage(
  path: string,
  params: Record<string, string | undefined>,
  options: SettlementApiOptions
): Promise<{ data: unknown[]; pageCount: number | null }> {
  const url = new URL(`${options.baseUrl ?? BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  }
  const fetchImpl: FetchLike =
    options.fetchImpl ?? ((input, init) => fetch(input, { ...init, cache: "no-store" }));
  const response = await fetchImpl(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${options.secretKey}` },
  });

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Paystack returned invalid JSON for ${path} (HTTP ${response.status}).`);
  }
  if (!response.ok || !isRecord(body) || body.status !== true || !Array.isArray(body.data)) {
    const message =
      isRecord(body) && typeof body.message === "string" ? body.message : `HTTP ${response.status}`;
    throw new Error(`Paystack request failed for ${path}: ${message}`);
  }
  const meta = isRecord(body.meta) ? body.meta : null;
  const pageCount = meta ? toInt(meta.pageCount) : NaN;
  return { data: body.data, pageCount: Number.isFinite(pageCount) ? pageCount : null };
}

async function getAllPages(
  path: string,
  params: Record<string, string | undefined>,
  options: SettlementApiOptions
): Promise<unknown[]> {
  const perPage = options.perPage ?? 100;
  const maxPages = options.maxPages ?? 500;
  const all: unknown[] = [];
  for (let page = 1; ; page += 1) {
    if (page > maxPages) {
      throw new Error(`Stopped after ${maxPages} pages of ${path}; narrow the date range.`);
    }
    const { data, pageCount } = await getPage(
      path,
      { ...params, perPage: String(perPage), page: String(page) },
      options
    );
    all.push(...data);
    const lastByCount = pageCount !== null && page >= pageCount;
    const lastBySize = data.length < perPage;
    if (lastByCount || lastBySize) break;
  }
  return all;
}

function parseDate(...candidates: unknown[]): Date | null {
  for (const value of candidates) {
    if (typeof value !== "string" || !value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

function parseTransaction(raw: unknown): ProviderSettlementTransaction | null {
  if (!isRecord(raw) || typeof raw.reference !== "string" || !raw.reference) return null;
  const fees = raw.fees === null || raw.fees === undefined ? null : toInt(raw.fees);
  return {
    reference: raw.reference,
    amountMinor: toInt(raw.amount),
    feesMinor: fees === null || Number.isNaN(fees) ? null : fees,
    currency: typeof raw.currency === "string" ? raw.currency : "",
    status: typeof raw.status === "string" ? raw.status : "",
  };
}

/** Settlement summaries only, newest pages as Paystack orders them. */
export async function listSettlements(
  options: SettlementApiOptions & { status?: string }
): Promise<{ id: string; status: string; settledAt: Date | null; totalAmountMinor: number }[]> {
  const rows = await getAllPages(
    "/settlement",
    {
      status: options.status ?? "success",
      // Main account only: Wetin Dey does not use subaccounts.
      subaccount: "none",
      from: options.from,
      to: options.to,
    },
    options
  );
  return rows.filter(isRecord).map((row) => ({
    id: String(row.id ?? ""),
    status: typeof row.status === "string" ? row.status : "",
    settledAt: parseDate(row.settlement_date, row.settledAt, row.updatedAt, row.createdAt),
    totalAmountMinor: toInt(row.total_amount),
  }));
}

export async function listSettlementTransactions(
  settlementId: string,
  options: SettlementApiOptions
): Promise<ProviderSettlementTransaction[]> {
  const rows = await getAllPages(
    `/settlement/${encodeURIComponent(settlementId)}/transactions`,
    {},
    options
  );
  return rows.map(parseTransaction).filter((t): t is ProviderSettlementTransaction => t !== null);
}

/**
 * Every successful settlement in the range, with its transactions.
 * Settlements with no usable id or date are skipped and counted, never
 * guessed at.
 */
export async function fetchSuccessfulSettlements(
  options: SettlementApiOptions
): Promise<{ settlements: ProviderSettlement[]; unusable: number }> {
  const summaries = await listSettlements({ ...options, status: "success" });
  const settlements: ProviderSettlement[] = [];
  let unusable = 0;
  for (const summary of summaries) {
    if (!summary.id || !summary.settledAt) {
      unusable += 1;
      continue;
    }
    const transactions = await listSettlementTransactions(summary.id, options);
    settlements.push({
      id: summary.id,
      status: summary.status,
      settledAt: summary.settledAt,
      transactions,
    });
  }
  return { settlements, unusable };
}
