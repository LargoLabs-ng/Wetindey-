import { NextResponse } from "next/server";
import { isPlatformAdmin } from "@/lib/authz";

export async function GET() {
  if (!(await isPlatformAdmin())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ authorized: true });
}
