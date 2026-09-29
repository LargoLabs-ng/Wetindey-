"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="rounded-lg border border-line-dark px-3 py-1.5 text-sm font-medium text-on-dark-2 transition-colors hover:border-gold hover:text-gold"
    >
      Sign out
    </button>
  );
}
