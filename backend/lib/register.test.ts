import { and, eq, sql as sqlRaw } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import {
  users,
  organizations,
  organizationMembers,
  departments,
  universities,
  campuses,
} from "@/db/schema";
import { createAccount } from "./register";

/**
 * Database-backed, and deliberately destructive-free: every case runs inside
 * a transaction that is rolled back, so no account, organization or
 * department survives the test. That is also why these exercise the real
 * createAccount rather than a reimplementation of it.
 *
 * Skipped when the database cannot actually be reached. Checking that
 * DATABASE_URL merely exists is not enough — a sandbox can hold a perfectly
 * valid URL it has no network route to, and the suite then fails on DNS
 * instead of skipping.
 */
const reachable = await (async () => {
  if (!process.env.DATABASE_URL) {
    console.info("[register.test] no DATABASE_URL — skipping database tests");
    return false;
  }
  try {
    await db.execute(sqlRaw`select 1`);
    return true;
  } catch (error) {
    console.info(
      `[register.test] database unreachable, skipping: ${(error as Error).message}`
    );
    return false;
  }
})();

/** Runs `body` against the database, then undoes everything it did. */
async function inRolledBackTransaction(
  body: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<void>
) {
  try {
    await db.transaction(async (tx) => {
      await body(tx);
      tx.rollback();
    });
  } catch (error) {
    // Drizzle signals a deliberate rollback by throwing. It is a DrizzleError
    // whose message is "Rollback" — NOT a class called TransactionRollbackError,
    // which is what an earlier version of this check looked for, so every
    // rolled-back case was reported as a failure even though the rollback had
    // worked perfectly. Both shapes are accepted so a future rename of the
    // error class does not silently break the suite again.
    const signal = error as { name?: string; message?: string } | undefined;
    const isDeliberateRollback =
      signal?.name === "TransactionRollbackError" || signal?.message === "Rollback";
    if (!isDeliberateRollback) throw error;
  }
}

describe.skipIf(!reachable)("createAccount", () => {
  let universityId: string;
  let campusId: string;
  let listedDepartment: { id: string; name: string; slug: string };

  beforeAll(async () => {
    const [uni] = await db.select().from(universities).limit(1);
    expect(uni, "seed a university first: POST /api/admin/seed-campus").toBeTruthy();
    universityId = uni.id;

    const [campus] = await db
      .select()
      .from(campuses)
      .where(eq(campuses.universityId, universityId))
      .limit(1);
    campusId = campus.id;

    const [dept] = await db
      .select()
      .from(departments)
      .where(
        and(
          eq(departments.universityId, universityId),
          eq(departments.status, "provisional")
        )
      )
      .limit(1);
    listedDepartment = dept;
  });

  it("saves campus context and creates no organization for a student", async () => {
    await inRolledBackTransaction(async (tx) => {
      const r = await createAccount(tx, {
        firstName: "Test",
        lastName: "Student",
        email: `test-student-${Date.now()}@example.invalid`,
        passwordHash: "not-a-real-hash",
        universityId,
        campusId,
        departmentId: listedDepartment.id,
      });

      expect(r.user.universityId).toBe(universityId);
      expect(r.user.campusId).toBe(campusId);
      expect(r.user.departmentId).toBe(listedDepartment.id);
      expect(r.organization).toBeNull();
      expect(r.suggestedDepartmentId).toBeNull();

      const memberships = await tx
        .select()
        .from(organizationMembers)
        .where(eq(organizationMembers.userId, r.user.id));
      expect(memberships).toHaveLength(0);
    });
  });

  it("files an unlisted department as pending, with no faculty guessed", async () => {
    await inRolledBackTransaction(async (tx) => {
      const typed = `Test Studies ${Date.now()}`;
      const r = await createAccount(tx, {
        firstName: "Test",
        lastName: "Typed",
        email: `test-typed-${Date.now()}@example.invalid`,
        passwordHash: "not-a-real-hash",
        universityId,
        newDepartmentName: typed,
      });

      const [dept] = await tx
        .select()
        .from(departments)
        .where(eq(departments.id, r.suggestedDepartmentId!))
        .limit(1);

      expect(dept.name).toBe(typed);
      // Pending, not provisional: it must not reach anyone else's picker
      // until a human has looked at it.
      expect(dept.status).toBe("pending");
      expect(dept.facultyId).toBeNull();
      expect(dept.suggestedBy).toBe(r.user.id);

      const [reread] = await tx
        .select()
        .from(users)
        .where(eq(users.id, r.user.id))
        .limit(1);
      expect(reread.departmentId).toBe(dept.id);
    });
  });

  it("links to an existing department instead of duplicating it", async () => {
    await inRolledBackTransaction(async (tx) => {
      const r = await createAccount(tx, {
        firstName: "Test",
        lastName: "Dupe",
        email: `test-dupe-${Date.now()}@example.invalid`,
        passwordHash: "not-a-real-hash",
        universityId,
        newDepartmentName: listedDepartment.name,
      });

      expect(r.suggestedDepartmentId).toBe(listedDepartment.id);

      const matches = await tx
        .select()
        .from(departments)
        .where(
          and(
            eq(departments.universityId, universityId),
            eq(departments.slug, listedDepartment.slug)
          )
        );
      expect(matches).toHaveLength(1);
      // Re-typing an existing name must not demote it to pending.
      expect(matches[0].status).toBe("provisional");
    });
  });

  it("creates an organization only when someone signs up to host", async () => {
    await inRolledBackTransaction(async (tx) => {
      const stamp = Date.now();
      const r = await createAccount(tx, {
        firstName: "Test",
        lastName: "Host",
        email: `test-host-${stamp}@example.invalid`,
        passwordHash: "not-a-real-hash",
        organizationName: `Test Society ${stamp}`,
        organizationSlug: `test-society-${stamp}`,
      });

      expect(r.organization).not.toBeNull();
      const [membership] = await tx
        .select()
        .from(organizationMembers)
        .where(eq(organizationMembers.userId, r.user.id));
      expect(membership.role).toBe("owner");
    });
  });

  it("leaves nothing behind", async () => {
    const leftover = await db.select().from(users);
    expect(leftover.filter((u) => u.email?.startsWith("test-"))).toHaveLength(0);
    const orgs = await db.select().from(organizations);
    expect(orgs.filter((o) => o.slug.startsWith("test-society-"))).toHaveLength(0);
  });
});
