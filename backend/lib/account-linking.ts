/**
 * What happens when someone signs in with Google using an email address
 * that already has a Wetin Dey account.
 *
 * Google sign-in is allowed to join an existing account with the same email
 * (`allowDangerousEmailAccountLinking` in auth.ts): without that, a student
 * who signed up with a password and later taps "Continue with Google" would
 * be refused. The danger is the other order of events:
 *
 *   1. Someone who does NOT own ada@gmail.com signs up with it and a
 *      password. Nothing checks the inbox at signup.
 *   2. Ada later taps "Continue with Google". Google proves she owns the
 *      address, and Auth.js joins her into that same account.
 *   3. The impostor still knows the password, so now two people share
 *      Ada's account — her tickets, her events, her payouts.
 *
 * The rule: a password is only trusted once its owner has proved the email
 * is theirs (the confirmation link from checkout). If Google proves
 * ownership of an address whose password was never confirmed, the password
 * goes. The real owner signs in with Google; whoever set the password can't
 * get back in with it. A confirmed password is kept, because its owner has
 * already shown the inbox is theirs.
 *
 * Pure, so every case is unit-tested; auth.ts does the database part.
 */

export type ExistingAccount = {
  hasPassword: boolean;
  emailVerified: boolean;
} | null;

export type GoogleLinkDecision =
  /** Sign in (or create the account) as normal. */
  | "allow"
  /** Sign in, but remove the never-confirmed password first. */
  | "allow-drop-password"
  /** Refuse: Google hasn't confirmed this address either. */
  | "deny";

export function decideGoogleLink(input: {
  googleEmailVerified: boolean;
  existing: ExistingAccount;
}): GoogleLinkDecision {
  // Without Google's confirmation, a Google sign-in proves nothing about the
  // address, so it must never be joined to anyone's account.
  if (!input.googleEmailVerified) return "deny";
  const existing = input.existing;
  if (!existing) return "allow";
  if (existing.hasPassword && !existing.emailVerified) return "allow-drop-password";
  return "allow";
}
