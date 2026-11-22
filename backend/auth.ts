import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, accounts, organizations, organizationMembers } from "@/db/schema";
import { verifyPassword } from "@/lib/password";
import { markEmailVerified } from "@/lib/buyer-account";
import { generateUniqueSlug } from "@/lib/slug";

const googleConfigured = Boolean(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
);

export const { handlers, signIn, signOut, auth } = NextAuth({
  secret: process.env.AUTH_SECRET,
  adapter: DrizzleAdapter(db, { usersTable: users, accountsTable: accounts }),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;

        if (!email || !password) return null;

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email.toLowerCase()))
          .limit(1);

        if (!user || !user.passwordHash) return null;

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
        };
      },
    }),
    ...(googleConfigured
      ? [
          Google({
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
  ],
  // No `createUser` event any more. It used to create an organization for
  // every new account, which made sense when every account was an organizer.
  // Students have accounts now, and an empty company attached to each one
  // breaks the routing that decides between the organizer dashboard and the
  // gate console. Organizations are created on demand instead — see
  // ensureOrganizationForUser in lib/organization.ts.
  events: {
    // Auth.js creates Google users with email_verified empty, even though
    // Google only signs someone in once it has confirmed the address.
    // Checkout requires a verified email, so record what Google told us.
    async signIn({ user, account, profile }) {
      if (
        account?.provider === "google" &&
        profile?.email_verified === true &&
        typeof user?.id === "string"
      ) {
        await markEmailVerified(user.id);
      }
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.userId = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.userId) {
        (session.user as { id?: string }).id = token.userId as string;
      }
      return session;
    },
  },
});
