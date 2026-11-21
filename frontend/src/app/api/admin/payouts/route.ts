import { NextRequest, NextResponse } from "next/server";
import { requirePayoutPermission } from "@/lib/payout-auth";
import { isPayoutStatus } from "@/lib/payout-lifecycle";
import { listPayoutRequests, payoutCounts } from "@/lib/payout-requests";

/**
 * GET /api/admin/payouts?status=pending|approved|processing|failed|paid|rejected|all
 *
 * The admin payout queue, with counts per status and each organisation's
 * settled / unsettled / available balance. Defaults to pending.
 * GET /api/admin/payouts?countsOnly=1 — counts per status only.
 */
export async function GET(request: NextRequest) {
  const auth = await requirePayoutPermission("payouts.view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // ?countsOnly=1 — just the numbers, for the nav badge.
  if (request.nextUrl.searchParams.get("countsOnly") === "1") {
    try {
      return NextResponse.json({ counts: await payoutCounts() });
    } catch (error) {
      console.error("Could not count payout requests:", error);
      return NextResponse.json({ error: "Could not count payout requests." }, { status: 500 });
    }
  }

  const raw = request.nextUrl.searchParams.get("status") ?? "pending";
  if (raw !== "all" && !isPayoutStatus(raw)) {
    return NextResponse.json({ error: "Unknown status." }, { status: 400 });
  }

  try {
    return NextResponse.json(await listPayoutRequests(raw));
  } catch (error) {
    console.error("Could not load payout requests:", error);
    return NextResponse.json({ error: "Could not load payout requests." }, { status: 500 });
  }
}
