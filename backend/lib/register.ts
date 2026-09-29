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
 * "My department isn't listed."
 *
 * Saved as `pending`: it belongs to the person who typed it straight away,
 * and stays out of everyone else's picker until someone reviews it — so one
 * student's typo cannot become a permanent option for the whole university.
 *
 * Exported because signup is no longer the only place this happens. A
 * student who skipped the question at signup and fills it in on their
 * profile later has to land in exactly the same state, and the way two code
 * paths drift apart is by each implementing this rule for themselves.
 */
export async function suggestDepartment(
  tx: Tx,
  input: { universityId: string; name: string; suggestedBy: string }
): Promise<string> {
  const slug = slugify(input.name);

  // Somebody may already have suggested it, or it may exist under a name we
  // seeded. Either way, join the existing row rather than making a second.
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

  if (already) return already.id;

  const [created] = await tx
    .insert(departments)
    .values({
      universityId: input.universityId,
      facultyId: null,
      name: input.name,
      slug,
      status: "pending",
      suggestedBy: input.suggestedBy,
    })
    .returning({ id: departments.id });

  return created.id;
}

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

  let suggestedDepartmentId: string | null = null;
  if (!input.departmentId && input.newDepartmentName && input.universityId) {
    suggestedDepartmentId = await suggestDepartment(tx, {
      universityId: input.universityId,
      name: input.newDepartmentName,
      suggestedBy: user.id,
    });

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
