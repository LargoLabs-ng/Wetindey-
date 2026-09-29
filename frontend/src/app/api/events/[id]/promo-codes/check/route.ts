import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { promoCodes } from "@/db/schema";
import { isUuid } from "@/lib/authz";
import { applyPromo, checkCode, normalizeCode, type PromoCode } from "@/lib/promo";

/**
 * POST /api/events/:id/promo-codes/check
 *
 * Public, because the buy box has to tell somebody their code worked before
 * it sends them to Paystack. Otherwise they find out by being charged the
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

  const [row] = await db
    .select()
    .from(promoCodes)
    .where(
      and(
        eq(promoCodes.eventId, id),
        // Case-insensitive, matching the unique index in 0011 and the
        // normalisation the order route does.
        sql`upper(${promoCodes.code}) = ${code}`
      )
    )
    .limit(1);

  const promo: PromoCode | null = row
    ? {
        id: row.id,
        kind: row.kind,
        code: row.code,
        label: row.label,
        promoterName: row.promoterName,
        rate: Number(row.rate),
        usageLimit: row.usageLimit,
        usedCount: row.usedCount,
        active: row.active,
      }
    : null;

  const check = checkCode(promo);
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
