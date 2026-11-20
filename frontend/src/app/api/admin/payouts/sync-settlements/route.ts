import { NextResponse } from "next/server";
import { z } from "zod";
import { isPlatformAdmin } from "@/lib/authz";
import {
  runPaystackSettlementSync,
  settlementWritesEnabled,
  summariseSync,
} from "@/lib/paystack-settlements";

// Reading every settlement the first time can take a while.
export const maxDuration = 60;

/** How many rows of each problem list the response carries. */
const LIST_LIMIT = 200;

const bodySchema = z.object({
  // Dry run unless someone explicitly asks to write.
  mode: z.enum(["dry-run", "write"]).default("dry-run"),
  // Optional ISO date. Omit to let the sync choose (all history on the first
  // run, then a week before the newest recorded settlement).
  from: z.string().trim().min(4).max(40).optional(),
});

/**
 * POST /api/admin/payouts/sync-settlements
 *
 * Super admins only in v1 (isPlatformAdmin). Behind the "Refresh from
 * Paystack" button on the admin Payouts page, which arrives in Stage 4.
 */
export async function POST(request: Request) {
  if (!(await isPlatformAdmin())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid sync request." }, { status: 400 });
  }
  if (parsed.data.mode === "write" && !settlementWritesEnabled()) {
    return NextResponse.json(
      {
        error:
          "Settlement writes are switched off. Review a dry run, then set SETTLEMENT_SYNC_ENABLED=true.",
      },
      { status: 409 }
    );
  }

  try {
    const result = await runPaystackSettlementSync({
      mode: parsed.data.mode,
      from: parsed.data.from ?? undefined,
    });
    const r = result.report;
    return NextResponse.json({
      summary: summariseSync(result),
      // The lists a person needs to review. References only: no buyer
      // details leave the server.
      details: {
        conflicts: r.conflicts.slice(0, LIST_LIMIT),
        wrongProvider: r.wrongProvider.slice(0, LIST_LIMIT),
        notSuccessLocally: r.notSuccessLocally.slice(0, LIST_LIMIT),
        amountMismatch: r.amountMismatch.slice(0, LIST_LIMIT),
        duplicateInProvider: r.duplicateInProvider.slice(0, LIST_LIMIT),
        notFound: r.notFound.slice(0, LIST_LIMIT),
        nonSuccessTransactions: r.nonSuccessTransactions.slice(0, LIST_LIMIT),
      },
    });
  } catch (error) {
    console.error("Settlement sync failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Settlement sync failed." },
      { status: 502 }
    );
  }
}
