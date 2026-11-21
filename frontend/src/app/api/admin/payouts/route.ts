import { NextRequest, NextResponse } from "next/server";
import { requirePayoutPermission } from "@/lib/payout-auth";
import { isPayoutStatus } from "@/lib/payout-lifecycle";
import { listPayoutRequests } from "@/lib/payout-requests";

/**
 * GET /api/admin/payouts?status=pending|approved|processing|failed|paid|rejected|all
 *
 * The admin payout queue, with counts per status and each organisation's
 * settled / unsettled / available balance. Defaults to pending.
 */
export async function GET(request: NextRequest) {
  const auth = await requirePayoutPermission("payouts.view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

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
