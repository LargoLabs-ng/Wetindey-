import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { registrationFields } from "@/db/schema";
import { isUuid, requireEventCapability } from "@/lib/authz";
import { normalizeFields, type FieldKind } from "@/lib/registration";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/events/:id/registration-fields
 *
 * Public, deliberately. These are the questions on a public checkout form —
 * anyone who can reach the buy button can already see them by clicking it.
 * Gating this would mean the checkout page needed a session to render, which
 * is exactly the guest checkout we went out of our way to keep.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ fields: [] });
  }

  const rows = await db
    .select()
    .from(registrationFields)
    .where(eq(registrationFields.eventId, id))
    .orderBy(asc(registrationFields.position));

  return NextResponse.json({ fields: rows });
}

/**
 * PUT /api/events/:id/registration-fields — replace the whole set.
 *
 * Whole-set rather than per-field CRUD because that is how the organiser
 * edits it: they add three questions, reorder them, delete one, and press
 * save once. Three endpoints and an optimistic list would give the same
 * result on a good day and an inconsistent order on a bad one.
 *
 * Gated on `event:edit`, the same capability as changing the date. Deciding
 * what four hundred people are asked for is an editorial act, not an
 * operational one — a gate volunteer does not get to add a question.
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const access = await requireEventCapability(id, "event:edit");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const body = await request.json().catch(() => null);
  const parsed = normalizeFields((body as { fields?: unknown })?.fields ?? body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const existing = await db
    .select({ id: registrationFields.id })
    .from(registrationFields)
    .where(eq(registrationFields.eventId, id));
  const existingIds = new Set(existing.map((r) => r.id));

  // An id the client sent that we don't recognise is treated as a new field
  // rather than an error. It means somebody's tab was open while the set was
  // edited elsewhere, and the cost of being wrong is a duplicate question the
  // organiser can see and delete — not a save that refuses and loses their work.
  const keep = parsed.fields
    .map((f) => f.id)
    .filter((fid): fid is string => !!fid && existingIds.has(fid));

  await db.transaction(async (tx) => {
    // Removed questions. The answers people already gave survive this: the
    // foreign key is ON DELETE SET NULL and each answer carries its own copy
    // of the label it was asked under.
    if (keep.length) {
      await tx
        .delete(registrationFields)
        .where(
          and(
            eq(registrationFields.eventId, id),
            notInArray(registrationFields.id, keep)
          )
        );
    } else {
      await tx
        .delete(registrationFields)
        .where(eq(registrationFields.eventId, id));
    }

    // Position comes from the array index, so the order the organiser sees is
    // the order the checkout form renders — no drag handles storing fractions.
    for (const [index, f] of parsed.fields.entries()) {
      const values = {
        eventId: id,
        label: f.label,
        kind: f.kind as FieldKind,
        options: f.options,
        required: f.required,
        position: index,
      };

      if (f.id && existingIds.has(f.id)) {
        await tx
          .update(registrationFields)
          .set(values)
          .where(eq(registrationFields.id, f.id));
      } else {
        await tx.insert(registrationFields).values(values);
      }
    }
  });

  const rows = await db
    .select()
    .from(registrationFields)
    .where(eq(registrationFields.eventId, id))
    .orderBy(asc(registrationFields.position));

  return NextResponse.json({ fields: rows });
}
