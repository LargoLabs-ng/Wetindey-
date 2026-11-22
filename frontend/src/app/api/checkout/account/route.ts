import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/authz";
import { getBuyerAccount } from "@/lib/buyer-account";

/**
 * GET /api/checkout/account — what the event page needs to pre-fill
 * checkout for the signed-in buyer, and whether their email is verified.
 *
 * Only ever describes the caller's own account.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const account = await getBuyerAccount(userId);
  if (!account) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  return NextResponse.json({
    email: account.email,
    fullName: account.fullName,
    phone: account.phone,
    emailVerified: account.emailVerified,
  });
}
