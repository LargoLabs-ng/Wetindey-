import { NextResponse } from "next/server";
import { asc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { universities, campuses, faculties, departments } from "@/db/schema";

/**
 * GET /api/campus — everything the signup and profile pickers need.
 *
 * Public on purpose: it is a list of universities and their departments,
 * which is not sensitive, and signup needs it before anyone has an account.
 *
 * `pending` and `rejected` departments are excluded. A department one
 * student typed is theirs immediately but must not appear in everyone
 * else's picker until it has been looked at, or the first typo becomes a
 * permanent option for the whole university.
 */
export async function GET() {
  const unis = await db
    .select()
    .from(universities)
    .orderBy(asc(universities.name));

  if (unis.length === 0) return NextResponse.json({ universities: [] });

  const ids = unis.map((u) => u.id);
  const [campusRows, facultyRows, departmentRows] = await Promise.all([
    db.select().from(campuses).where(inArray(campuses.universityId, ids)).orderBy(asc(campuses.name)),
    db.select().from(faculties).where(inArray(faculties.universityId, ids)).orderBy(asc(faculties.name)),
    db
      .select()
      .from(departments)
      .where(inArray(departments.universityId, ids))
      .orderBy(asc(departments.name)),
  ]);

  const visible = departmentRows.filter(
    (d) => d.status === "confirmed" || d.status === "provisional"
  );

  return NextResponse.json({
    universities: unis.map((u) => ({
      id: u.id,
      name: u.name,
      shortName: u.shortName,
      slug: u.slug,
      campuses: campusRows
        .filter((c) => c.universityId === u.id)
        .map((c) => ({ id: c.id, name: c.name, city: c.city })),
      faculties: facultyRows
        .filter((f) => f.universityId === u.id)
        .map((f) => ({ id: f.id, name: f.name, campusId: f.campusId })),
      departments: visible
        .filter((d) => d.universityId === u.id)
        .map((d) => ({ id: d.id, name: d.name, facultyId: d.facultyId })),
    })),
  });
}
