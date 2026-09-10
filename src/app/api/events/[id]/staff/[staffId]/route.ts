import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { eventStaff } from "@/db/schema";
import { requireEventCapability } from "@/lib/authz";

type RouteContext = { params: Promise<{ id: string; staffId: string }> };

const updateSchema = z.object({
  role: z.enum(["event_manager", "gate_staff", "finance"]),
});

/** PATCH /api/events/:id/staff/:staffId — change someone's role. */
export async function PATCH(request: Request, context: RouteContext) {
  const { id, staffId } = await context.params;
  const access = await requireEventCapability(id, "team:manage");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const [updated] = await db
    .update(eventStaff)
    .set({ role: parsed.data.role })
    .where(and(eq(eventStaff.id, staffId), eq(eventStaff.eventId, id)))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ staff: updated });
}

/** DELETE /api/events/:id/staff/:staffId — take someone off this event. */
export async function DELETE(_request: Request, context: RouteContext) {
  const { id, staffId } = await context.params;
  const access = await requireEventCapability(id, "team:manage");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const [removed] = await db
    .delete(eventStaff)
    .where(and(eq(eventStaff.id, staffId), eq(eventStaff.eventId, id)))
    .returning();

  if (!removed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
