import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { events } from "@/db/schema";
import { can } from "./permissions";
import type { OrgRole } from "./authz";
import {
  eventRobots,
  isLive,
  isPubliclyListed,
  normalizeVisibility,
  publicListingWhere,
} from "./event-visibility";

const live = { status: "published", archivedAt: null };

describe("isPubliclyListed — what discovery may show", () => {
  it("lists a published, public event", () => {
    expect(isPubliclyListed({ ...live, visibility: "public" })).toBe(true);
  });

  it("does not list an unlisted event", () => {
    expect(isPubliclyListed({ ...live, visibility: "unlisted" })).toBe(false);
  });

  it("treats an event with no visibility (older data) as public", () => {
    expect(isPubliclyListed({ ...live })).toBe(true);
    expect(isPubliclyListed({ ...live, visibility: null })).toBe(true);
  });

  it("still hides drafts, unpublished, cancelled and archived events", () => {
    for (const status of ["draft", "unpublished", "cancelled"]) {
      expect(isPubliclyListed({ status, archivedAt: null, visibility: "public" })).toBe(false);
    }
    expect(
      isPubliclyListed({ status: "published", archivedAt: new Date(), visibility: "public" })
    ).toBe(false);
  });
});

describe("isLive — direct link and checkout ignore visibility", () => {
  it("an unlisted published event is live: its link opens and tickets sell", () => {
    // The slug route and the orders route gate on exactly this condition
    // (published and not archived); visibility plays no part in it.
    expect(isLive({ status: "published", archivedAt: null })).toBe(true);
  });

  it("drafts and archived events are not live", () => {
    expect(isLive({ status: "draft", archivedAt: null })).toBe(false);
    expect(isLive({ status: "published", archivedAt: new Date() })).toBe(false);
  });
});

describe("publicListingWhere — the SQL every public listing uses", () => {
  const { sql, params } = new PgDialect().sqlToQuery(publicListingWhere()!);

  it("requires published, not archived, and public", () => {
    expect(sql).toContain('"events"."status" = $');
    expect(sql).toContain('"events"."archived_at" is null');
    expect(sql).toContain('"events"."visibility" = $');
    expect(params).toEqual(["published", "public"]);
  });
});

describe("eventRobots — search engine instructions", () => {
  it("noindex, nofollow for unlisted events", () => {
    expect(eventRobots({ visibility: "unlisted" })).toEqual({
      index: false,
      follow: false,
      googleBot: { index: false, follow: false },
    });
  });

  it("nothing for public events, so their metadata is unchanged", () => {
    expect(eventRobots({ visibility: "public" })).toBeUndefined();
    expect(eventRobots({})).toBeUndefined();
  });
});

describe("existing events stay public", () => {
  it("anything but 'unlisted' normalises to public", () => {
    expect(normalizeVisibility("unlisted")).toBe("unlisted");
    for (const v of ["public", undefined, null, "", "PUBLIC", "private"]) {
      expect(normalizeVisibility(v)).toBe("public");
    }
  });

  it("the schema column defaults to public and is required", () => {
    expect(events.visibility.default).toBe("public");
    expect(events.visibility.notNull).toBe(true);
    expect(events.visibility.enumValues).toEqual(["public", "unlisted"]);
  });

  it("migration 0020 is additive, defaults to public and is safe to run twice", () => {
    const file = readFileSync(
      path.resolve(__dirname, "../migrations/0020_event_visibility.sql"),
      "utf8"
    );
    expect(file).toContain(`CREATE TYPE "event_visibility" AS ENUM ('public', 'unlisted')`);
    expect(file).toContain("EXCEPTION WHEN duplicate_object THEN NULL");
    expect(file).toContain(
      `ADD COLUMN IF NOT EXISTS "visibility" "event_visibility" NOT NULL DEFAULT 'public'`
    );
    // Additive only: nothing dropped, nothing rewritten.
    expect(file).not.toMatch(/\bDROP\b|\bUPDATE\b|\bDELETE\b/i);
  });
});

describe("who may change visibility", () => {
  // PATCH /api/events/:id requires event:edit; visibility rides on it.
  const roles: OrgRole[] = ["owner", "event_manager", "gate_staff", "viewer", "promoter", "finance"];

  it("only owners and event managers hold event:edit", () => {
    const editors = roles.filter((r) => can(r, "event:edit"));
    expect(editors).toEqual(["owner", "event_manager"]);
  });

  it("the finance switch does not grant edit", () => {
    expect(can("viewer", "event:edit", { canSeeFinances: true })).toBe(false);
    expect(can("event_manager", "event:edit", { canSeeFinances: true })).toBe(true);
  });
});
