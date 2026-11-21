import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  runPaystackSettlementSync,
  settlementWritesEnabled,
  summariseSync,
} from "@/lib/paystack-settlements";

export const maxDuration = 60;

function authorised(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const received = Buffer.from(request.headers.get("authorization") ?? "", "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/**
 * GET /api/cron/settlements
 *
 * The scheduled settlement sync, once a day (vercel.json). Until
 * SETTLEMENT_SYNC_ENABLED=true it only ever dry-runs, so the schedule cannot
 * write anything before someone switches writes on.
 */
export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }
  if (!authorised(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runPaystackSettlementSync({
      mode: settlementWritesEnabled() ? "write" : "dry-run",
    });
    const summary = summariseSync(result);
    console.log("Settlement sync:", JSON.stringify(summary));
    return NextResponse.json({ summary });
  } catch (error) {
    console.error("Scheduled settlement sync failed:", error);
    return NextResponse.json({ error: "Settlement sync failed." }, { status: 502 });
  }
}
