import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts, users } from "@/db/schema";

/**
 * The signed-in account, as checkout needs it: who is buying, where their
 * tickets go, and whether that address is proven.
 *
 * Read from the database on every call rather than from the session token,
 * so verifying in another tab counts immediately and nothing about
 * verification ever lives in a cookie.
 */
export type BuyerAccount = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string | null;
  emailVerified: boolean;
};

export async function getBuyerAccount(userId: string): Promise<BuyerAccount | null> {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      name: users.name,
      phone: users.phone,
      emailVerified: users.emailVerified,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return null;

  let verified = user.emailVerified !== null;

  // Google confirms the address before it signs anyone in, but Auth.js
  // creates OAuth users with email_verified empty. auth.ts now records it on
  // every Google sign-in; this catches accounts that signed in with Google
  // before that change, so they aren't asked to verify an address Google
  // already vouched for.
  if (!verified) {
    const [google] = await db
      .select({ userId: accounts.userId })
      .from(accounts)
      .where(and(eq(accounts.userId, user.id), eq(accounts.provider, "google")))
      .limit(1);
    if (google) {
      await markEmailVerified(user.id);
      verified = true;
    }
  }

  const firstName = user.firstName?.trim() ?? "";
  const lastName = user.lastName?.trim() ?? "";
  const fullName = `${firstName} ${lastName}`.trim() || user.name?.trim() || "";

  return {
    id: user.id,
    email: user.email,
    firstName,
    lastName,
    fullName,
    phone: user.phone ?? null,
    emailVerified: verified,
  };
}

/** Set once; never moves an existing verification date. */
export async function markEmailVerified(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ emailVerified: new Date() })
    .where(and(eq(users.id, userId), isNull(users.emailVerified)));
}
