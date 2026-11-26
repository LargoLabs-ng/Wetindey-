import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, organizationMembers, organizations } from "@/db/schema";
import { generateUniqueSlug, slugify } from "@/lib/slug";

/**
 * First-time organiser setup.
 *
 * Before this, somebody's organisation appeared silently the first time they
 * made an event, named "<their name>'s Events". That name then sat on every
 * ticket email, and the only way to learn it existed was to see it there.
 * Now a new organiser is asked once — name, logo, and optionally where the
 * money goes — before the event wizard opens.
 *
 * The rules, in one place so the pages and the dashboard gate agree:
 *
 *   - An organisation "is hosting" once its owner confirmed its name
 *     (setupCompletedAt) or it already has events. Old organisations with
 *     events are never sent back through setup.
 *   - Setup never creates a second organisation for someone who already owns
 *     one. An owner of an old, never-confirmed organisation confirms THAT
 *     one; the screen is pre-filled with its current name.
 *   - Only OWNER memberships count. Being door staff, or any other role, on
 *     somebody else's event or organisation gives no say over that
 *     organisation and must never be mistaken for owning one.
 */

export const ORG_NAME_MIN = 2;
export const ORG_NAME_MAX = 200;

export type OwnedOrganization = {
  id: string;
  name: string;
  logoUrl: string | null;
  setupCompletedAt: Date | null;
  eventCount: number;
};

/** Confirmed by its owner, or already running events. */
export function isHostingOrganization(org: {
  setupCompletedAt: Date | null;
  eventCount: number;
}): boolean {
  return Boolean(org.setupCompletedAt) || org.eventCount > 0;
}

/** True when the setup screen should come before the event wizard. */
export function needsOrganiserSetup(owned: OwnedOrganization[]): boolean {
  return !owned.some(isHostingOrganization);
}

/**
 * Which organisation the setup screen works on: the first hosting one if
 * there is one (setup is then already done), otherwise the oldest one they
 * own, otherwise none (a new one will be created).
 */
export function pickSetupTarget(
  owned: OwnedOrganization[]
): OwnedOrganization | null {
  return owned.find(isHostingOrganization) ?? owned[0] ?? null;
}

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

/** Trims, collapses inner spaces, and enforces the length limits. */
export function cleanOrganizationName(raw: unknown): NameCheck {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (name.length < ORG_NAME_MIN) {
    return { ok: false, error: "Enter the name people know you by." };
  }
  if (name.length > ORG_NAME_MAX) {
    return { ok: false, error: `Keep the name under ${ORG_NAME_MAX} characters.` };
  }
  return { ok: true, name };
}

/**
 * Logos are uploaded through our own upload route, which only ever returns
 * https links. Anything else is refused rather than stored and later
 * rendered as an <img> on every event page.
 */
export function cleanLogoUrl(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined; // not sent: leave as it is
  if (raw === null || raw === "") return null; // sent empty: remove it
  if (typeof raw !== "string" || raw.length > 2000) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

type Executor = Pick<typeof db, "select">;

/** Organisations this person OWNS, oldest membership first, with event counts. */
export async function getOwnedOrganizations(
  userId: string,
  executor: Executor = db
): Promise<OwnedOrganization[]> {
  const rows = await executor
    .select({
      id: organizations.id,
      name: organizations.name,
      logoUrl: organizations.logoUrl,
      setupCompletedAt: organizations.setupCompletedAt,
      eventCount: sql<number>`(
        select count(*)::int from ${events}
        where ${events.organizationId} = ${organizations.id}
      )`,
    })
    .from(organizationMembers)
    .innerJoin(
      organizations,
      eq(organizations.id, organizationMembers.organizationId)
    )
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.role, "owner")
      )
    )
    .orderBy(asc(organizationMembers.createdAt));

  return rows.map((r) => ({ ...r, eventCount: Number(r.eventCount) }));
}

export type SetupResult = {
  organizationId: string;
  /** "created" a new one, "confirmed" an old one, or it was "already" done. */
  outcome: "created" | "confirmed" | "already";
};

/**
 * Create or confirm the person's organisation. Never makes a duplicate.
 *
 * A double-tapped Continue button sends two requests at once. Both would
 * see "owns nothing" and both would create an organisation, so the work is
 * done inside a transaction holding a lock keyed on this person: the second
 * request waits, then sees the first one's organisation and stops.
 */
export async function completeOrganiserSetup(
  userId: string,
  input: { name: string; logoUrl: string | null | undefined }
): Promise<SetupResult> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${"organiser-setup:" + userId}))`
    );

    const owned = await getOwnedOrganizations(userId, tx);
    const target = pickSetupTarget(owned);

    if (target && isHostingOrganization(target)) {
      return { organizationId: target.id, outcome: "already" as const };
    }

    if (target) {
      await tx
        .update(organizations)
        .set({
          name: input.name,
          ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
          setupCompletedAt: new Date(),
        })
        .where(eq(organizations.id, target.id));
      return { organizationId: target.id, outcome: "confirmed" as const };
    }

    // The slug is internal (no public page uses it) but must be unique.
    // Checked with the transaction's own connection: the app's database
    // client has a single connection, so asking `db` here would wait on
    // ourselves forever.
    // A name written only in characters the slug drops (emoji, say) would
    // leave nothing to build on, so it falls back to a plain word.
    const base = slugify(input.name) ? input.name : "organisation";
    const slug = await generateUniqueSlug(base, async (candidate) => {
      const [hit] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.slug, candidate))
        .limit(1);
      return !!hit;
    });

    const [organization] = await tx
      .insert(organizations)
      .values({
        name: input.name,
        slug,
        ownerId: userId,
        logoUrl: input.logoUrl ?? null,
        setupCompletedAt: new Date(),
      })
      .returning({ id: organizations.id });

    await tx.insert(organizationMembers).values({
      organizationId: organization.id,
      userId,
      role: "owner",
    });

    return { organizationId: organization.id, outcome: "created" as const };
  });
}
