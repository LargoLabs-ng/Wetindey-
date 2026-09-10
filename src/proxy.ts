import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Protects everything under /dashboard — staff only, never attendees
// (attendees never authenticate in this product; see README decision #2).
export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const path = req.nextUrl.pathname;
  // /checkin is the gate console — same rule, and its own layout double-checks.
  const isProtected =
    path.startsWith("/dashboard") || path.startsWith("/checkin");

  if (isProtected && !isLoggedIn) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
});

export const config = {
  matcher: ["/dashboard/:path*", "/checkin/:path*"],
};
