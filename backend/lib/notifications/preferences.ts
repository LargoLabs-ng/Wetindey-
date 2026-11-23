/**
 * Who gets what, on which channel, by default — and what can't be turned off.
 *
 * Defaults live here in code. The `notification_preferences` table stores
 * only the switches someone changed, so adding a category later needs no
 * migration. Locked switches ignore any stored row: they concern tickets,
 * money or account security, and are always on.
 *
 * Discovery (confirmed): in-app ON by default, at most one bundle a day;
 * email and push are OPT-IN — off until the person switches them on.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { notificationPreferences } from "@/db/schema";

export const CHANNELS = ["in_app", "email", "push"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CATEGORIES = [
  "tickets",
  "event_changes",
  "announcements",
  "reminders",
  "discovery",
  "sales",
  "payouts",
  "account_security",
  "team",
  "moderation",
  "admin_actions",
  "platform_health",
] as const;
export type Category = (typeof CATEGORIES)[number];

type Switch = { on: boolean; locked?: boolean };
type Row = Record<Channel, Switch>;

const on: Switch = { on: true };
const off: Switch = { on: false };
const locked: Switch = { on: true, locked: true };

export const DEFAULTS: Record<Category, Row> = {
  tickets: { in_app: locked, email: locked, push: on },
  event_changes: { in_app: locked, email: on, push: on },
  announcements: { in_app: on, email: off, push: on },
  reminders: { in_app: on, email: on, push: on },
  discovery: { in_app: on, email: off, push: off },
  sales: { in_app: on, email: on, push: on },
  payouts: { in_app: locked, email: locked, push: on },
  account_security: { in_app: locked, email: locked, push: on },
  team: { in_app: on, email: on, push: off },
  moderation: { in_app: on, email: off, push: on },
  admin_actions: { in_app: locked, email: on, push: on },
  platform_health: { in_app: locked, email: locked, push: off },
};

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

export function isLocked(category: Category, channel: Channel): boolean {
  return DEFAULTS[category][channel].locked === true;
}

/**
 * The effective switch, given the stored override (if any).
 * `essential` is for a single notification that must reach someone even in
 * a category they muted — a cancellation of an event they hold tickets for.
 */
export function resolveSwitch(
  category: Category,
  channel: Channel,
  stored: boolean | undefined,
  options: { essential?: boolean } = {}
): boolean {
  if (options.essential) return true;
  const base = DEFAULTS[category][channel];
  if (base.locked) return true;
  return stored ?? base.on;
}

/** Stored overrides for many people at once: Map<userId, Map<"category:channel", enabled>>. */
export type OverrideMap = Map<string, Map<string, boolean>>;

export async function loadOverrides(userIds: string[]): Promise<OverrideMap> {
  const map: OverrideMap = new Map();
  if (userIds.length === 0) return map;
  const rows = await db
    .select({
      userId: notificationPreferences.userId,
      category: notificationPreferences.category,
      channel: notificationPreferences.channel,
      enabled: notificationPreferences.enabled,
    })
    .from(notificationPreferences)
    .where(inArray(notificationPreferences.userId, [...new Set(userIds)]));
  for (const row of rows) {
    if (!map.has(row.userId)) map.set(row.userId, new Map());
    map.get(row.userId)!.set(`${row.category}:${row.channel}`, row.enabled);
  }
  return map;
}

export function allowed(
  overrides: OverrideMap,
  userId: string | null | undefined,
  category: Category,
  channel: Channel,
  options: { essential?: boolean } = {}
): boolean {
  const stored = userId ? overrides.get(userId)?.get(`${category}:${channel}`) : undefined;
  return resolveSwitch(category, channel, stored, options);
}

/**
 * Change one switch. Refuses locked switches. Used by the settings page in
 * Phase 2; here so the rule lives next to the defaults.
 */
export async function setPreference(
  userId: string,
  category: Category,
  channel: Channel,
  enabled: boolean
): Promise<{ ok: true } | { ok: false; reason: "locked" }> {
  if (isLocked(category, channel)) return { ok: false, reason: "locked" };
  await db
    .insert(notificationPreferences)
    .values({ userId, category, channel, enabled, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [
        notificationPreferences.userId,
        notificationPreferences.category,
        notificationPreferences.channel,
      ],
      set: { enabled, updatedAt: new Date() },
    });
  return { ok: true };
}

export async function getPreference(
  userId: string,
  category: Category,
  channel: Channel
): Promise<boolean> {
  const [row] = await db
    .select({ enabled: notificationPreferences.enabled })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.category, category),
        eq(notificationPreferences.channel, channel)
      )
    )
    .limit(1);
  return resolveSwitch(category, channel, row?.enabled);
}
