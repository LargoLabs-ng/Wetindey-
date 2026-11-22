import { NextResponse } from "next/server";
import { isPlatformAdmin } from "@/lib/authz";
import { deliveryHealth } from "@/lib/notifications/admin-health";

/** GET /api/admin/notifications — delivery health. Super Admin only. */
export async function GET() {
  if (!(await isPlatformAdmin())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    return NextResponse.json(await deliveryHealth());
  } catch (error) {
    console.error("Could not load notification health:", error);
    return NextResponse.json({ error: "Could not load notification health." }, { status: 500 });
  }
}
