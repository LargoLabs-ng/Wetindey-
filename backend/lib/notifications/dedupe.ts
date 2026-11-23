/**
 * Unique keys — one per layer, each exactly as specific as what it protects.
 *
 *   event     `<type>:<entityId>`                     recorded once per happening
 *   inbox     `<eventKey>:<userId>`                   one bell entry per person
 *   email     `<eventKey>:<userId or email>:email`    one email per address
 *   push      `<eventKey>:<userId>:push:<deviceId>`   one push per device
 *   digest    `digest:<kind>:<userId>:<period>`       one summary per period
 *
 * The database enforces each with a UNIQUE constraint; inserts use
 * ON CONFLICT DO NOTHING, so repeating any step creates nothing new.
 */

export function eventKey(type: string, ...parts: Array<string | number>): string {
  if (parts.length === 0) throw new Error("eventKey needs at least one part after the type");
  return [type, ...parts].map(String).join(":");
}

export function inboxKey(eventDedupeKey: string, userId: string): string {
  return `${eventDedupeKey}:${userId}`;
}

/** Addresses are compared lowercased, so "Ada@x.com" and "ada@x.com" are one. */
export function emailKey(eventDedupeKey: string, recipient: { userId?: string | null; email?: string | null }): string {
  const who = recipient.userId || (recipient.email ?? "").trim().toLowerCase();
  if (!who) throw new Error("emailKey needs a userId or an email");
  return `${eventDedupeKey}:${who}:email`;
}

export function pushKey(eventDedupeKey: string, userId: string, subscriptionId: string): string {
  return `${eventDedupeKey}:${userId}:push:${subscriptionId}`;
}

export function digestKey(kind: string, userId: string, period: string): string {
  return `digest:${kind}:${userId}:${period}`;
}
