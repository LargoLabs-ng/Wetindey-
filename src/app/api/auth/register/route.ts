import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  users,
  organizations,
  organizationMembers,
  departments,
} from "@/db/schema";
import { hashPassword } from "@/lib/password";
import { createAccount } from "@/lib/register";
import { generateUniqueSlug } from "@/lib/slug";

/**
 * Signup.
 *
 * An account no longer implies an organization. Most accounts are students,
 * and an organization is created the moment someone first creates an event
 * (see lib/organization.ts). Passing organizationName here is the explicit
 * "I'm here to host" path and is the only thing that makes one up front.
 */
const registerSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().min(7).max(32).optional(),
  password: z.string().min(8, "Password must be at least 8 characters"),

  // Campus context, all optional — a student can skip it and fill it in later.
  universityId: z.string().uuid().optional(),
  campusId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  /** Typed by the student when their department isn't in the list. */
  newDepartmentName: z.string().trim().min(2).max(200).optional(),

  /** Present only when someone signs up intending to host events. */
  organizationName: z.string().min(1).max(200).optional(),
});

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const {
    firstName,
    lastName,
    phone,
    universityId,
    campusId,
    departmentId,
    newDepartmentName,
    organizationName,
  } = parsed.data;
  const email = parsed.data.email.toLowerCase();

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 }
    );
  }

  // A department id from the client has to belong to the university the
  // client also claims, or the two fields disagree in the database forever.
  if (departmentId && universityId) {
    const [valid] = await db
      .select({ id: departments.id })
      .from(departments)
      .where(
        and(
          eq(departments.id, departmentId),
          eq(departments.universityId, universityId)
        )
      )
      .limit(1);
    if (!valid) {
      return NextResponse.json(
        { error: "That department doesn't belong to the university you picked." },
        { status: 400 }
      );
    }
  }

  const passwordHash = await hashPassword(parsed.data.password);

  const orgSlug = organizationName
    ? await generateUniqueSlug(organizationName, async (candidate) => {
        const [collision] = await db
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.slug, candidate))
          .limit(1);
        return !!collision;
      })
    : null;

  const result = await db.transaction((tx) =>
    createAccount(tx, {
      firstName,
      lastName,
      email,
      phone,
      passwordHash,
      universityId,
      campusId,
      departmentId,
      newDepartmentName,
      organizationName,
      organizationSlug: orgSlug ?? undefined,
    })
  );

  return NextResponse.json(
    {
      user: {
        id: result.user.id,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        email: result.user.email,
      },
      organization: result.organization
        ? {
            id: result.organization.id,
            name: result.organization.name,
            slug: result.organization.slug,
          }
        : null,
    },
    { status: 201 }
  );
}
