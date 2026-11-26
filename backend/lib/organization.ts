import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations, organizationMembers, users } from "@/db/schema";
import { generateUniqueSlug } from "@/lib/slug";
import { getPrimaryOrganizationId } from "@/lib/authz";

/**
 * Get the user's organization, creating one the first time they need it.
 *
 * Signup used to mint an organization for every new account, including
 * Google sign-ins. That was fine when everyone was an organizer. Now that
 * students have accounts it would make every student the owner of an empty
 * company — which, among other things, breaks the dashboard-versus-gate
 * routing, because "owns an organization" is how that decision is made.
 *
 * So nobody gets one at signup. An organization appears at the moment
 * someone actually creates an event, which is the only point it means
 * anything.
 *
 * Since Phase 6 the event wizard sends a first-time organiser through the
 * setup screen (lib/organiser-setup.ts) first, so the organisation already
 * exists with a name they chose. This remains the safety net for anything
 * that reaches the event API directly.
 */
export async function ensureOrganizationForUser(
  userId: string
): Promise<string> {
  // Only an organisation they OWN. Any other membership is somebody else's
  // organisation, and an event created there would land in a stranger's
  // dashboard. getPrimaryOrganizationId applies exactly that rule.
  const existing = await getPrimaryOrganizationId(userId);
  if (existing) return existing;

  const [user] = await db
    .select({ name: users.name, firstName: users.firstName, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const baseName =
    user?.name?.trim() ||
    user?.firstName?.trim() ||
    user?.email?.split("@")[0] ||
    "My";
  const orgName = `${baseName}'s Events`;

  const slug = await generateUniqueSlug(orgName, async (candidate) => {
    const [collision] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, candidate))
      .limit(1);
    return !!collision;
  });

  const [organization] = await db
    .insert(organizations)
    .values({ name: orgName, slug, ownerId: userId })
    .returning();

  await db.insert(organizationMembers).values({
    organizationId: organization.id,
    userId,
    role: "owner",
  });

  return organization.id;
}
