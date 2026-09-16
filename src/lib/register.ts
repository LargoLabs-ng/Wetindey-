import { and, eq } from "drizzle-orm";
import { organizations, organizationMembers, users, departments } from "@/db/schema";
import type { db as Database } from "@/db";

/** The transaction handle Drizzle hands to db.transaction(). */
type Tx = Parameters<Parameters<typeof Database.transaction>[0]>[0];

export type NewAccount = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  passwordHash: string;
  universityId?: string;
  campusId?: string;
  departmentId?: string;
  /** Typed by the student when their department isn't in the list. */
  newDepartmentName?: string;
  /** Present only when someone signs up intending to host events. */
  organizationName?: string;
  organizationSlug?: string;
};

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * Everything signup writes, in one place and one transaction.
 *
 * Lives here rather than inside the route handler so it can be exercised
 * directly — a test can run it inside a transaction it rolls back, and check
 * the real code rather than a reimplementation of it.
 */
export async function createAccount(tx: Tx, input: NewAccount) {
  const [user] = await tx
    .insert(users)
    .values({
      firstName: input.firstName,
      lastName: input.lastName,
      name: `${input.firstName} ${input.lastName}`,
      email: input.email,
      phone: input.phone,
      passwordHash: input.passwordHash,
      universityId: input.universityId ?? null,
      campusId: input.campusId ?? null,
      departmentId: input.departmentId ?? null,
    })
    .returning();

  // "My department isn't listed." Saved as pending: theirs straight away,
  // absent from everyone else's picker until reviewed, so one typo cannot
  // become a permanent option for the whole university.
  let suggestedDepartmentId: string | null = null;
  if (!input.departmentId && input.newDepartmentName && input.universityId) {
    const slug = slugify(input.newDepartmentName);
    const [already] = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(
        and(
          eq(departments.universityId, input.universityId),
          eq(departments.slug, slug)
        )
      )
      .limit(1);

    suggestedDepartmentId =
      already?.id ??
      (
        await tx
          .insert(departments)
          .values({
            universityId: input.universityId,
            facultyId: null,
            name: input.newDepartmentName,
            slug,
            status: "pending",
            suggestedBy: user.id,
          })
          .returning({ id: departments.id })
      )[0].id;

    await tx
      .update(users)
      .set({ departmentId: suggestedDepartmentId })
      .where(eq(users.id, user.id));
  }

  if (input.organizationName && input.organizationSlug) {
    const [organization] = await tx
      .insert(organizations)
      .values({
        name: input.organizationName,
        slug: input.organizationSlug,
        ownerId: user.id,
      })
      .returning();

    await tx.insert(organizationMembers).values({
      organizationId: organization.id,
      userId: user.id,
      role: "owner",
    });

    return { user, organization, suggestedDepartmentId };
  }

  return { user, organization: null, suggestedDepartmentId };
}
