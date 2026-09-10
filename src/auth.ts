import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, accounts, organizations, organizationMembers } from "@/db/schema";
import { verifyPassword } from "@/lib/password";
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
  events: {
    async createUser({ user }) {
      if (!user.id) return;

      const baseName = user.name?.trim() || user.email?.split("@")[0] || "My";
      const orgName = `${baseName}'s Organization`;

      const slug = await generateUniqueSlug(orgName, async (candidate) => {
        const [existing] = await db
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.slug, candidate))
          .limit(1);
        return !!existing;
      });

      const [organization] = await db
        .insert(organizations)
        .values({ name: orgName, slug, ownerId: user.id })
        .returning();

      await db.insert(organizationMembers).values({
        organizationId: organization.id,
        userId: user.id,
        role: "owner",
      });
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
