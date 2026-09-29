import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cancellationBill, refundEverybody } from "@/lib/cancel-event";
import { requireEventCapability } from "@/lib/authz";

type RouteContext = { params: Promise<{ id: string }> };

const schema = z.object({
  /** The total the caller believes they are about to send, in naira. */
  expectedTotal: z.number().nonnegative(),
  confirm: z.literal(true),
});

/**
 * POST /api/events/:id/refund-all
 *
 * Sends every buyer their money back. This is the irreversible one.
 *
 * Three locks, and each is here because of a specific way this goes wrong:
 *
 *   `refund:issue`   not everyone who can cancel an event may move money.
 *   event cancelled  refunding an event that is still going ahead would
 *                    leave a hall full of people holding void tickets.
 *   expectedTotal    the caller states the figure they saw, and it is
 *                    re-checked against the live bill. If someone bought a
 *                    ticket between the organiser reading the total and
 *                    pressing the button, this refuses rather than quietly
 *                    sending a different amount than the one they approved.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const access = await requireEventCapability(id, "refund:issue");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  if (access.event.status !== "cancelled") {
    return NextResponse.json(
      { error: "Cancel the event before refunding everyone." },
      { status: 409 }
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Confirm the exact total you are refunding." },
      { status: 400 }
    );
  }

  const bill = await cancellationBill(id);

  // A kobo of tolerance for float arithmetic, and nothing more. This is the
  // check that stops a stale page from authorising a number nobody read.
  if (Math.abs(bill.buyerRefundTotal - parsed.data.expectedTotal) > 0.01) {
    return NextResponse.json(
      {
        error: "The total has changed since you last looked. Check it again.",
        expected: parsed.data.expectedTotal,
        actual: bill.buyerRefundTotal,
      },
      { status: 409 }
    );
  }

  const result = await refundEverybody(id, access.userId);

  return NextResponse.json({
    ...result,
    // Surfaced rather than buried: a partial failure needs someone to chase
    // it, and a count of successes alone reads like everything worked.
    needsAttention: result.failed > 0,
  });
}
