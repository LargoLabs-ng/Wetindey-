import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSessionUserId } from "@/lib/authz";
import { appUrl } from "@/lib/app-url";
import { BRAND_NAME } from "@/lib/brand";
import { escapeHtml, sendEmailWithResult } from "@/lib/email-service";
import { getBuyerAccount, markEmailVerified } from "@/lib/buyer-account";
import {
  createVerificationToken,
  readVerificationToken,
} from "@/lib/email-verification";
import { safeCallbackPath } from "@/lib/safe-redirect";

/**
 * POST /api/auth/verify-email — { returnTo? }
 * Email the signed-in account a link that proves the address is theirs.
 * `returnTo` is where the link lands afterwards (the event they were
 * buying for), checked to be a path on this site.
 *
 * GET /api/auth/verify-email?token=…&next=…
 * The link itself. Marks the address verified and sends them on to `next`.
 */

// Best-effort throttle, same approach as ticket recovery: in memory, per
// server instance. Enough to stop a button being hammered.
const lastSent = new Map<string, number>();
const COOLDOWN_MS = 60_000;

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const account = await getBuyerAccount(userId);
  if (!account) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }
  if (account.emailVerified) {
    return NextResponse.json({ verified: true });
  }

  const body = await request.json().catch(() => ({}));
  const returnTo = safeCallbackPath(
    typeof body?.returnTo === "string" ? body.returnTo : null,
    "/"
  );

  const previous = lastSent.get(userId) ?? 0;
  if (Date.now() - previous < COOLDOWN_MS) {
    return NextResponse.json(
      {
        error: "We just sent you a link. Give it a minute, and check your spam folder too.",
        email: account.email,
      },
      { status: 429 }
    );
  }
  lastSent.set(userId, Date.now());

  const token = createVerificationToken({ userId, email: account.email });
  const link = appUrl(
    `/api/auth/verify-email?token=${encodeURIComponent(token)}&next=${encodeURIComponent(returnTo)}`
  );
  const greeting = account.firstName ? `Hi ${escapeHtml(account.firstName)},` : "Hi,";

  const result = await sendEmailWithResult({
    to: account.email,
    subject: `Confirm your email for ${BRAND_NAME}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #1f1a2e; background-color: #f8f7f3; margin: 0; padding: 24px 12px;">
          <div style="max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 28px 22px;">
            <p style="margin: 0 0 12px 0;">${greeting}</p>
            <p style="margin: 0 0 20px 0;">Tap the button to confirm this is your email. Your tickets will be sent here.</p>
            <p style="margin: 0 0 24px 0;">
              <a href="${escapeHtml(link)}" style="display: inline-block; background: #6c3cff; color: #ffffff; text-decoration: none; font-weight: 700; padding: 12px 22px; border-radius: 10px;">Confirm my email</a>
            </p>
            <p style="margin: 0; font-size: 13px; color: #6b6780;">The link works for 24 hours. If you didn't ask for this, you can ignore it.</p>
            <p style="margin: 24px 0 0 0; font-size: 12px; color: #9a96a8;">© ${BRAND_NAME}</p>
          </div>
        </body>
      </html>
    `,
  });

  if (!result.ok) {
    // Let them try again straight away rather than waiting out a cooldown
    // for an email that never left.
    lastSent.delete(userId);
    return NextResponse.json(
      { error: "We couldn't send the email just now. Please try again." },
      { status: 502 }
    );
  }

  return NextResponse.json({ sent: true, email: account.email });
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const next = safeCallbackPath(request.nextUrl.searchParams.get("next"), "/");
  const claim = readVerificationToken(token);

  const failed = () =>
    NextResponse.redirect(
      appUrl(`/verify-email?status=invalid&next=${encodeURIComponent(next)}`)
    );

  if (!claim) return failed();

  // The address inside the token has to still be the account's address.
  // Addresses can't be edited today, but if that ever changes an old link
  // must not vouch for a new one.
  const [match] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, claim.userId), sql`lower(${users.email}) = ${claim.email}`))
    .limit(1);
  if (!match) return failed();

  await markEmailVerified(claim.userId);
  return NextResponse.redirect(appUrl(next));
}
