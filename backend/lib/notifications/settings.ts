/**
 * The notification settings page: which switches a person sees, in plain words.
 *
 * Only topics the system actually sends today are shown, so no switch does
 * nothing. Attendee topics (reminders, new events near you, announcements)
 * join in Phase 3, and push switches in Phase 4.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { platformAdminAssignments } from "@/db/schema";
import { getStaffedEvents } from "@/lib/authz";
import { can } from "@/lib/permissions";
import {
  DEFAULTS,
  loadOverrides,
  resolveSwitch,
  type Category,
  type Channel,
} from "./preferences";

/** Channels shown on the page today. Push arrives in Phase 4. */
export const SHOWN_CHANNELS = ["in_app", "email"] as const satisfies readonly Channel[];
export type ShownChannel = (typeof SHOWN_CHANNELS)[number];

type TopicCopy = {
  category: Category;
  title: string;
  description: string;
  /** Wording for each channel's switch, when it means something specific. */
  channelLabel?: Partial<Record<ShownChannel, string>>;
  /** Why a locked switch can't be turned off. */
  lockedReason?: string;
};

type SectionId = "organiser" | "admin";

const SECTIONS: Record<SectionId, { title: string; topics: TopicCopy[] }> = {
  organiser: {
    title: "Your events",
    topics: [
      {
        category: "sales",
        title: "Sales and RSVPs",
        description: "Each new sale or RSVP, and when a ticket type sells out.",
        channelLabel: { email: "Daily summary email" },
      },
      {
        category: "payouts",
        title: "Payouts",
        description: "When a payout request is approved, sent, paid or needs attention.",
        lockedReason: "Always on: it's about your money.",
      },
      {
        category: "account_security",
        title: "Bank account changes",
        description: "When the bank account your payouts go to is changed.",
        lockedReason: "Always on, to keep your money safe.",
      },
      {
        category: "moderation",
        title: "Reported messages",
        description: "When someone reports a message in one of your event conversations.",
      },
    ],
  },
  admin: {
    title: "Admin",
    topics: [
      {
        category: "admin_actions",
        title: "Admin alerts",
        description:
          "Payout requests, payments that need review, departments waiting for approval and reported messages.",
        lockedReason: "Always on in the app for admins.",
      },
      {
        category: "platform_health",
        title: "Notification problems",
        description: "A warning when notifications fail or get stuck.",
        lockedReason: "Always on, so problems are never missed.",
      },
    ],
  },
};

export type SettingSwitch = {
  channel: ShownChannel;
  label: string;
  on: boolean;
  locked: boolean;
  lockedReason: string | null;
};

export type SettingTopic = {
  category: Category;
  title: string;
  description: string;
  switches: SettingSwitch[];
};

export type SettingSection = { id: SectionId; title: string; topics: SettingTopic[] };

const DEFAULT_LABEL: Record<ShownChannel, string> = { in_app: "In the app", email: "Email" };

/** Organisers and their teams: anyone who can see at least one event in the dashboard. */
async function isOrganiser(userId: string): Promise<boolean> {
  const staffed = await getStaffedEvents(userId);
  return staffed.some((e) => can(e.role, "event:view"));
}

/** Any admin role at all, or a bootstrap admin email. */
async function isAnyAdmin(userId: string, email: string | null | undefined): Promise<boolean> {
  const allowed = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (email && allowed.includes(email.toLowerCase())) return true;
  try {
    const [row] = await db
      .select({ roleId: platformAdminAssignments.roleId })
      .from(platformAdminAssignments)
      .where(and(eq(platformAdminAssignments.userId, userId), eq(platformAdminAssignments.status, "active")))
      .limit(1);
    return Boolean(row);
  } catch (error) {
    // Databases without the admin tables have no admins beyond the list above.
    if (typeof error === "object" && error && "code" in error && error.code === "42P01") return false;
    throw error;
  }
}

/** The sections this person sees, with each switch's current state. */
export async function settingsFor(userId: string, email: string | null | undefined): Promise<SettingSection[]> {
  const [organiser, admin, overrides] = await Promise.all([
    isOrganiser(userId),
    isAnyAdmin(userId, email),
    loadOverrides([userId]),
  ]);
  const mine = overrides.get(userId);

  const ids: SectionId[] = [];
  if (organiser) ids.push("organiser");
  if (admin) ids.push("admin");

  return ids.map((id) => ({
    id,
    title: SECTIONS[id].title,
    topics: SECTIONS[id].topics.map((topic) => ({
      category: topic.category,
      title: topic.title,
      description: topic.description,
      switches: SHOWN_CHANNELS.map((channel) => {
        const locked = DEFAULTS[topic.category][channel].locked === true;
        return {
          channel,
          label: topic.channelLabel?.[channel] ?? DEFAULT_LABEL[channel],
          on: resolveSwitch(topic.category, channel, mine?.get(`${topic.category}:${channel}`)),
          locked,
          lockedReason: locked ? (topic.lockedReason ?? "Always on.") : null,
        };
      }),
    })),
  }));
}

/** A switch may be changed only if it's on this person's page and not locked. */
export async function canChange(
  userId: string,
  email: string | null | undefined,
  category: Category,
  channel: Channel
): Promise<boolean> {
  if (!(SHOWN_CHANNELS as readonly string[]).includes(channel)) return false;
  if (DEFAULTS[category][channel].locked) return false;
  const sections = await settingsFor(userId, email);
  return sections.some((s) => s.topics.some((t) => t.category === category));
}
