"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      // Back to the public home page, not a login form: signing out of the
      // organiser side shouldn't feel like being locked out of the app.
      onClick={() => signOut({ callbackUrl: "/" })}
      className="rounded-lg border border-line-dark px-3 py-1.5 text-sm font-medium text-on-dark-2 transition-colors hover:border-gold hover:text-gold"
    >
      Sign out
    </button>
  );
}
