import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/lib/authz";
import { applyPromo, checkCode, normalizeCode } from "@/lib/promo";
import { loadPromoCode } from "@/lib/promo-lookup";

/**
 * POST /api/events/:id/promo-codes/check
 *
 * Public, because the buy box has to tell somebody their code worked before
 * it sends them to checkout. Otherwise they find out by being charged the
 * wrong amount.
 *
 * Three things it deliberately does NOT do:
 *
 *  - It never lists codes. You can only ask about an exact string you already
 *    have, which is the same thing typing it into the box does.
 *  - It never returns the commission on a referral code. What a promoter
 *    earns is between them and the organiser; the buyer's price is unchanged
 *    and that is all the buyer is told.
 *  - It never reserves or increments anything. This is a preview. The real
 *    application happens in the order route, which re-resolves the code from
 *    scratch — a client that lies here gets nothing.
 *
 * POST rather than GET so the code stays out of URLs, server logs and
 * browser history.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ ok: false, reason: "Event not found." });
  }

  const body = await request.json().catch(() => null);
  const code = normalizeCode((body as { code?: unknown })?.code);
  if (!code) {
    return NextResponse.json({ ok: false, reason: "Enter a code." });
  }

  const rawFace = Number((body as { faceValue?: unknown })?.faceValue);
  const faceValue = Number.isFinite(rawFace) && rawFace > 0 ? rawFace : 0;

  // Which ticket type the buyer has picked, so a tier-limited code is
  // refused here — before they pay — rather than silently ignored at checkout.
  const rawTier = (body as { ticketTypeId?: unknown })?.ticketTypeId;
  const ticketTypeId = typeof rawTier === "string" && isUuid(rawTier) ? rawTier : null;

  const promo = await loadPromoCode(id, code);

  const check = checkCode(promo, { ticketTypeId });
  if (!check.ok) {
    return NextResponse.json({ ok: false, reason: check.reason });
  }

  const effect = applyPromo(faceValue, check.code);

  return NextResponse.json({
    ok: true,
    code: check.code.code,
    kind: check.code.kind,
    // A discount says what it took off. A referral says nothing about money,
    // because nothing about the buyer's money has changed.
    discount: effect.discount,
    faceAfter: effect.faceAfter,
    message:
      check.code.kind === "discount"
        ? `Code applied${effect.discount > 0 ? "" : " — no change to this ticket"}.`
        : "Code applied. Your price is unchanged.",
  });
}
