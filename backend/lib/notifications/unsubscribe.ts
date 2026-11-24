/**
 * One-click unsubscribe links for notification emails.
 *
 * A link carries who it's for, which kind of email, and when it stops
 * working, signed with a key derived from AUTH_SECRET. Change any part and
 * the signature no longer matches, so nobody can forge a link or point one
 * at someone else. Locked emails (tickets, money, security) never get one,
 * and a link for a locked category is refused anyway.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { appUrl } from "@/lib/app-url";
import { escapeHtml } from "@/lib/email-service";
import { isCategory, isLocked, type Category } from "./preferences";

/** Long enough for an old email to still work, short enough to retire. */
export const LINK_DAYS = 180;

/** Where renderEmail leaves room for the unsubscribe line. */
export const UNSUBSCRIBE_MARKER = "<!--wd:unsubscribe-->";

/** How the confirmation page names each kind of email. */
const EMAIL_NAMES: Partial<Record<Category, string>> = {
  sales: "daily sales summary emails",
  moderation: "reported-message emails",
  admin_actions: "admin alert emails",
  team: "team emails",
  announcements: "organiser announcement emails",
  reminders: "event reminder emails",
  discovery: "new-event emails",
  event_changes: "event change emails",
};

export function emailName(category: Category): string {
  return EMAIL_NAMES[category] ?? "these emails";
}

function key(): Buffer | null {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  // A key of its own, so these links can never be mistaken for a login token.
  return createHmac("sha256", secret).update("wetindey:notification-unsubscribe:v1").digest();
}

const b64 = (buf: Buffer) => buf.toString("base64url");

/** null when this email can't carry an unsubscribe link. */
export function unsubscribeToken(
  userId: string,
  category: Category,
  now: Date = new Date()
): string | null {
  const k = key();
  if (!k || isLocked(category, "email")) return null;
  const expires = Math.floor(now.getTime() / 1000) + LINK_DAYS * 86_400;
  const payload = b64(Buffer.from(JSON.stringify({ u: userId, c: category, x: expires })));
  const signature = b64(createHmac("sha256", k).update(payload).digest());
  return `${payload}.${signature}`;
}

export type TokenCheck =
  | { ok: true; userId: string; category: Category }
  | { ok: false; reason: "invalid" | "expired" };

export function readUnsubscribeToken(token: string | null | undefined, now: Date = new Date()): TokenCheck {
  const k = key();
  if (!k || !token || token.length > 600) return { ok: false, reason: "invalid" };
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return { ok: false, reason: "invalid" };

  const expected = createHmac("sha256", k).update(payload).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "invalid" };
  }

  let data: { u?: unknown; c?: unknown; x?: unknown };
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (typeof data.u !== "string" || typeof data.c !== "string" || typeof data.x !== "number") {
    return { ok: false, reason: "invalid" };
  }
  if (!isCategory(data.c) || isLocked(data.c, "email")) return { ok: false, reason: "invalid" };
  if (data.x * 1000 < now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, userId: data.u, category: data.c };
}

/**
 * The finished email for one person: the unsubscribe line in the footer and
 * the headers Gmail and Yahoo use for their own Unsubscribe button.
 * Essential and locked emails come back unchanged, minus the marker.
 */
export function withUnsubscribe(
  html: string,
  opts: { userId: string | null; category: string; essential: boolean }
): { html: string; headers?: Record<string, string> } {
  const token =
    !opts.essential && opts.userId && isCategory(opts.category)
      ? unsubscribeToken(opts.userId, opts.category)
      : null;
  if (!token) return { html: html.replace(UNSUBSCRIBE_MARKER, "") };

  const pageUrl = appUrl(`/unsubscribe?t=${encodeURIComponent(token)}`);
  const oneClickUrl = appUrl(`/api/notifications/unsubscribe?t=${encodeURIComponent(token)}`);
  const line =
    `<p style="margin: 20px 0 0 0; font-size: 12px; color: #9a96a8;">` +
    `Don't want ${escapeHtml(emailName(opts.category as Category))}? ` +
    `<a href="${escapeHtml(pageUrl)}" style="color: #6b6780;">Unsubscribe</a> · ` +
    `<a href="${escapeHtml(appUrl("/profile/notifications"))}" style="color: #6b6780;">All settings</a></p>`;

  return {
    html: html.includes(UNSUBSCRIBE_MARKER) ? html.replace(UNSUBSCRIBE_MARKER, line) : html,
    headers: {
      "List-Unsubscribe": `<${oneClickUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
