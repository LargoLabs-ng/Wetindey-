import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { universities, campuses, faculties, departments } from "@/db/schema";
import { isPlatformAdmin, getSessionUserId } from "@/lib/authz";
import {
  UNICROSS,
  CAMPUSES,
  FACULTIES,
  UNPLACED_DEPARTMENTS,
} from "@/lib/seed/unicross";

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

async function guard() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isPlatformAdmin())) {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }
  return null;
}

/** GET — what is currently seeded. */
export async function GET() {
  const denied = await guard();
  if (denied) return denied;

  const [uni] = await db
    .select()
    .from(universities)
    .where(eq(universities.slug, UNICROSS.slug))
    .limit(1);
  if (!uni) return NextResponse.json({ seeded: false });

  const [c, f, d] = await Promise.all([
    db.select().from(campuses).where(eq(campuses.universityId, uni.id)),
    db.select().from(faculties).where(eq(faculties.universityId, uni.id)),
    db.select().from(departments).where(eq(departments.universityId, uni.id)),
  ]);

  return NextResponse.json({
    seeded: true,
    university: uni.name,
    campuses: c.length,
    faculties: f.length,
    departments: {
      total: d.length,
      withFaculty: d.filter((x) => x.facultyId).length,
      unplaced: d.filter((x) => !x.facultyId).length,
      pending: d.filter((x) => x.status === "pending").length,
    },
  });
}

/**
 * POST — seed or top up UNICROSS.
 *
 * Bulk inserts with onConflictDoNothing rather than a row at a time: the
 * per-row version made about sixty sequential round-trips to Neon and timed
 * out before finishing. Conflicts are keyed on (university_id, slug), so
 * re-running is harmless and never overwrites a correction someone made.
 */
export async function POST() {
  const denied = await guard();
  if (denied) return denied;

  await db.insert(universities).values(UNICROSS).onConflictDoNothing();
  const [uni] = await db
    .select()
    .from(universities)
    .where(eq(universities.slug, UNICROSS.slug))
    .limit(1);
  if (!uni) {
    return NextResponse.json({ error: "University row missing" }, { status: 500 });
  }

  await db
    .insert(campuses)
    .values(CAMPUSES.map((c) => ({ ...c, universityId: uni.id })))
    .onConflictDoNothing();
  const campusRows = await db
    .select()
    .from(campuses)
    .where(eq(campuses.universityId, uni.id));
  const campusIdBySlug = new Map(campusRows.map((c) => [c.slug, c.id]));

  await db
    .insert(faculties)
    .values(
      FACULTIES.map((f) => ({
        universityId: uni.id,
        campusId: campusIdBySlug.get(f.campus) ?? null,
        name: f.name,
        slug: f.slug,
      }))
    )
    .onConflictDoNothing();
  const facultyRows = await db
    .select()
    .from(faculties)
    .where(eq(faculties.universityId, uni.id));
  const facultyIdBySlug = new Map(facultyRows.map((f) => [f.slug, f.id]));

  const departmentValues = [
    ...FACULTIES.flatMap((f) =>
      f.departments.map((name) => ({
        universityId: uni.id,
        facultyId: facultyIdBySlug.get(f.slug) ?? null,
        name,
        slug: slugify(name),
        status: "provisional" as const,
      }))
    ),
    // Real programmes whose faculty nothing published stated. Left
    // unattached rather than guessed at.
    ...UNPLACED_DEPARTMENTS.map((name) => ({
      universityId: uni.id,
      facultyId: null,
      name,
      slug: slugify(name),
      status: "provisional" as const,
    })),
  ];

  await db.insert(departments).values(departmentValues).onConflictDoNothing();

  const all = await db
    .select()
    .from(departments)
    .where(eq(departments.universityId, uni.id));

  return NextResponse.json({
    university: uni.name,
    campuses: campusRows.length,
    faculties: facultyRows.length,
    departments: {
      total: all.length,
      withFaculty: all.filter((d) => d.facultyId).length,
      unplaced: all.filter((d) => !d.facultyId).length,
    },
  });
}
