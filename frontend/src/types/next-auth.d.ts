import type { DefaultSession } from "next-auth";

// Augments Auth.js's default Session type so `session.user.id` is
// properly typed everywhere instead of needing a manual cast at every
// call site.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}
