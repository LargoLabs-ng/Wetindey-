import { NextRequest, NextResponse } from "next/server";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { orders, promoCodes, tickets } from "@/db/schema";
import { requireEventCapability } from "@/lib/authz";
import type { CodePerformance, PromoKind } from "@/lib/promo";

type RouteContext = { params: Promise<{ id: string }> };

const codeSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["discount", "refer_to_earn"]),
  /**
   * The string people type. Letters, numbers and dashes only: a code with a
   * space gets mistyped, and one with a slash breaks the share link it ends
   * up inside.
   */
  code: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[A-Za-z0-9-]+$/, "Codes can only use letters, numbers and dashes."),
  label: z.string().trim().max(120).nullish(),
  promoterName: z.string().trim().max(120).nullish(),
  rate: z.coerce.number().min(0).max(100),
  usageLimit: z.coerce.number().int().min(1).nullish(),
  active: z.boolean().optional(),
});

const bodySchema = z.object({ codes: z.array(codeSchema).max(40) });

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Every code on an event, with what it has actually done.
 *
 * Three small queries rather than one clever aggregate: joining tickets into
 * a sum of order subtotals multiplies the revenue by the ticket count, and
 * the version that avoids that is harder to read than this is to run.
 */
async function loadCodes(eventId: string) {
  const codes = await db
    .select()
    .from(promoCodes)
    .where(eq(promoCodes.eventId, eventId));

  if (codes.length === 0) return [];

  /**
   * PAID orders only.
   *
   * A pending order is somebody who opened Paystack and wandered off.
   * Counting it would show an organiser revenue that never arrived and —
   * worse — commission they do not owe.
   */
  const orderRows = await db
    .select({
      promoCodeId: orders.promoCodeId,
      id: orders.id,
      subtotal: orders.subtotal,
      discountAmount: orders.discountAmount,
      commissionAmount: orders.commissionAmount,
    })
    .from(orders)
    .where(and(eq(orders.eventId, eventId), eq(orders.status, "paid")));

  const ticketCounts = await db
    .select({ orderId: tickets.orderId, n: sql<number>`count(*)::int` })
    .from(tickets)
    .where(eq(tickets.eventId, eventId))
    .groupBy(tickets.orderId);

  const ticketsByOrder = new Map(ticketCounts.map((r) => [r.orderId, r.n]));

  const perf = new Map<string, CodePerformance>();
  for (const c of codes) {
    perf.set(c.id, {
      code: c.code,
      kind: c.kind as PromoKind,
      label: c.label,
      promoterName: c.promoterName,
      rate: Number(c.rate),
      orders: 0,
      tickets: 0,
      revenue: 0,
      discountGiven: 0,
      commissionOwed: 0,
      usageLimit: c.usageLimit,
      usedCount: c.usedCount,
      active: c.active,
    });
  }

  for (const o of orderRows) {
    if (!o.promoCodeId) continue;
    const row = perf.get(o.promoCodeId);
    if (!row) continue;
    row.orders += 1;
    row.tickets += ticketsByOrder.get(o.id) ?? 0;
    row.revenue += Number(o.subtotal) || 0;
    row.discountGiven += Number(o.discountAmount) || 0;
    row.commissionOwed += Number(o.commissionAmount) || 0;
  }

  return codes.map((c) => {
    const p = perf.get(c.id)!;
    return {
      id: c.id,
      ...p,
      revenue: round2(p.revenue),
      discountGiven: round2(p.discountGiven),
      commissionOwed: round2(p.commissionOwed),
    };
  });
}

/**
 * GET /api/events/:id/promo-codes
 *
 * Gated on `finance:view` rather than `event:edit`. These numbers are money —
 * revenue brought in, commission owed — and the point of the finance switch
 * is that seeing money is a separate decision from being allowed to change
 * things.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const access = await requireEventCapability(id, "finance:view");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  return NextResponse.json({ codes: await loadCodes(id) });
}

/**
 * PUT /api/events/:id/promo-codes — replace the whole set.
 *
 * Whole-set for the same reason the registration fields are: an organiser
 * adds two codes, switches one off, deletes another, and presses save once.
 *
 * Gated on `event:edit`, NOT on `finance:view`. Reading what a code earned
 * and creating one that gives money away are different acts, and the money
 * switch deliberately grants only the first.
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const access = await requireEventCapability(id, "event:edit");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: first?.message ?? "Those codes aren't valid." },
      { status: 400 }
    );
  }

  const seen = new Set<string>();
  for (const c of parsed.data.codes) {
    // Two codes differing only in case are one code at checkout, where
    // matching is case-insensitive. Caught here rather than at the unique
    // index, so the organiser gets a sentence instead of a constraint name.
    const key = c.code.toUpperCase();
    if (seen.has(key)) {
      return NextResponse.json(
        { error: `You've used the code "${c.code}" twice.` },
        { status: 400 }
      );
    }
    seen.add(key);

    if (c.kind === "refer_to_earn" && !c.promoterName?.trim()) {
      return NextResponse.json(
        {
          error: `"${c.code}" needs a name — somebody has to be owed the commission.`,
        },
        { status: 400 }
      );
    }
  }

  const existing = await db
    .select({ id: promoCodes.id })
    .from(promoCodes)
    .where(eq(promoCodes.eventId, id));
  const existingIds = new Set(existing.map((r) => r.id));

  const keep = parsed.data.codes
    .map((c) => c.id)
    .filter((cid): cid is string => !!cid && existingIds.has(cid));

  try {
    await db.transaction(async (tx) => {
      // Deleting a code does NOT delete the orders that used it — the foreign
      // key is ON DELETE SET NULL, and each order keeps its own discount and
      // commission figures. The money that changed hands is a fact; the code
      // is only the reason it did.
      if (keep.length) {
        await tx
          .delete(promoCodes)
          .where(
            and(eq(promoCodes.eventId, id), notInArray(promoCodes.id, keep))
          );
      } else {
        await tx.delete(promoCodes).where(eq(promoCodes.eventId, id));
      }

      for (const c of parsed.data.codes) {
        const values = {
          eventId: id,
          kind: c.kind,
          code: c.code.toUpperCase(),
          label: c.label?.trim() || null,
          promoterName: c.promoterName?.trim() || null,
          rate: String(c.rate),
          usageLimit: c.usageLimit ?? null,
          active: c.active ?? true,
        };

        if (c.id && existingIds.has(c.id)) {
          // usedCount is deliberately absent from `values`: it records what
          // has happened, not what was configured, and a save must never
          // reset it.
          await tx.update(promoCodes).set(values).where(eq(promoCodes.id, c.id));
        } else {
          await tx.insert(promoCodes).values(values);
        }
      }
    });
  } catch (error) {
    console.error("Saving promo codes failed:", error);
    return NextResponse.json(
      { error: "Could not save those codes. One of them may already exist." },
      { status: 409 }
    );
  }

  // Answers with the same shape GET does, so the editor rebuilds itself from
  // the response and picks up ids for codes it just created.
  return NextResponse.json({ codes: await loadCodes(id) });
}
