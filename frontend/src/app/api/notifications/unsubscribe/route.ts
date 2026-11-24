import { NextRequest, NextResponse } from "next/server";
import { setPreference } from "@/lib/notifications/preferences";
import { allowRequest } from "@/lib/notifications/rate-limit";
import { emailName, readUnsubscribeToken } from "@/lib/notifications/unsubscribe";

/**
 * POST /api/notifications/unsubscribe?t=<signed link>
 *
 * Two callers: Gmail/Yahoo's own Unsubscribe button (a form post with
 * "List-Unsubscribe=One-Click"), and our confirmation page, which can also
 * send { "resubscribe": true } for Undo. No sign-in: the signed link is the
 * proof, and it only ever touches its own person's one kind of email.
 */
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!allowRequest(`unsub:${ip}`, 30)) {
    return NextResponse.json({ error: "Too many tries. Wait a minute." }, { status: 429 });
  }

  const check = readUnsubscribeToken(request.nextUrl.searchParams.get("t"));
  if (!check.ok) {
    return NextResponse.json(
      { error: check.reason === "expired" ? "This link has expired." : "This link doesn't work." },
      { status: check.reason === "expired" ? 410 : 400 }
    );
  }

  let resubscribe = false;
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    const body = await request.json().catch(() => null);
    resubscribe = body?.resubscribe === true;
  }

  try {
    await setPreference(check.userId, check.category, "email", resubscribe);
  } catch (error) {
    // The account no longer exists: nothing left to email.
    console.error("Unsubscribe failed:", error);
    return NextResponse.json({ error: "This link doesn't work any more." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, subscribed: resubscribe, name: emailName(check.category) });
}
