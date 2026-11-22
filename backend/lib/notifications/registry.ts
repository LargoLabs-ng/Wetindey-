/**
 * What each kind of event turns into.
 *
 * A handler is registered per event type ("order.paid", ...). Given the
 * outbox row, it works out the recipients — using the current data and the
 * existing permission rules, not whatever was true when the event happened —
 * and what each of them should see. The fan-out step then applies
 * preferences and writes the inbox rows and deliveries.
 *
 * Handlers are added in later stages (sales, payouts, admin alerts, ...);
 * this file only defines the shape and the registry.
 */
import type { Category } from "./preferences";

export type EventRow = {
  id: string;
  type: string;
  dedupeKey: string;
  payload: Record<string, unknown>;
  createdAt: Date;
};

export type InAppContent = {
  title: string;
  body?: string | null;
  url?: string | null;
  data?: Record<string, unknown>;
};

export type EmailContent = {
  subject: string;
  html: string;
};

export type Recipient = {
  /** Account holder, when there is one. Guests have only an email. */
  userId?: string | null;
  /** Where email goes. For account holders, their account address. */
  email?: string | null;
  category: Category;
  /**
   * Must reach this person even if they muted the category (a cancellation
   * of an event they hold tickets for). Also exempt from the daily email
   * budget and from the stale-email rule.
   */
  essential?: boolean;
  inApp?: InAppContent | null;
  emailContent?: EmailContent | null;
};

export type HandlerResult = {
  recipients: Recipient[];
  /** Set when more recipients remain; the next run continues from here. */
  nextCursor?: string | null;
};

export type Handler = {
  resolve(event: EventRow, cursor: string | null, pageSize: number): Promise<HandlerResult>;
};

const handlers = new Map<string, Handler>();

export function registerHandler(type: string, handler: Handler): void {
  handlers.set(type, handler);
}

export function getHandler(type: string): Handler | undefined {
  return handlers.get(type);
}

/** For tests. */
export function clearHandlers(): void {
  handlers.clear();
}
