import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isUuid } from "@/lib/authz";
import { requirePayoutPermission } from "@/lib/payout-auth";
import { notifyOrganiserOfPayoutStatus } from "@/lib/payout-emails";
import { PAYOUT_ACTIONS } from "@/lib/payout-lifecycle";
import {
  applyPayoutAction,
  getPayoutRequest,
  PayoutRequestError,
} from "@/lib/payout-requests";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/admin/payouts/[id] — one request, its events and its history. */
export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requirePayoutPermission("payouts.view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const request = await getPayoutRequest(id);
    if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ request });
  } catch (error) {
    console.error("Could not load payout request:", error);
    return NextResponse.json({ error: "Could not load this payout request." }, { status: 500 });
  }
}

const actionSchema = z.object({
  action: z.enum(PAYOUT_ACTIONS),
  reason: z.string().max(2000).optional(),
  paymentReference: z.string().max(500).optional(),
  note: z.string().max(2000).optional(),
});

/**
 * POST /api/admin/payouts/[id]
 * { action: "approve" | "process" | "mark_paid" | "mark_failed" | "reject",
 *   reason?, paymentReference?, note? }
 *
 * Moving money is never done here: "process" records that an admin has
 * started the bank transfer by hand, "mark_paid" that it arrived.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requirePayoutPermission("payouts.manage");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose a valid action." }, { status: 400 });
  }

  try {
    const result = await applyPayoutAction({
      payoutId: id,
      actorId: auth.userId,
      action: parsed.data,
    });
    // Approved, paid, rejected and failed are worth an email; "being sent"
    // is a step for us, not news for them.
    if (result.to !== "processing") after(() => notifyOrganiserOfPayoutStatus(result.id));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof PayoutRequestError) {
      return NextResponse.json({ error: error.message, ...error.extra }, { status: error.status });
    }
    console.error("Payout action failed:", error);
    return NextResponse.json({ error: "That didn't work. Nothing was changed." }, { status: 500 });
  }
}
