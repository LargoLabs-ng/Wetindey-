import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Enums ───────────────────────────────────────────────────────────────

export const orgRoleEnum = pgEnum("org_role", [
  "owner",
  "event_manager",
  "gate_staff",
  "finance",
  // Sees how it's going, changes nothing.
  "viewer",
  // Sells with their own link and sees only what they sold by it.
  "promoter",
]);

export const eventStatusEnum = pgEnum("event_status", [
  "draft",
  "published",
  "unpublished",
  "cancelled",
]);

export const ticketTypeStatusEnum = pgEnum("ticket_type_status", [
  "active",
  "paused",
  "sold_out",
]);

export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "paid",
  "expired",
  "cancelled",
  "refunded",
]);

export const ticketStatusEnum = pgEnum("ticket_status", [
  "pending",
  "valid",
  "checked_in",
  "cancelled",
  "refunded",
  "invalid",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "initialized",
  "pending",
  "success",
  "failed",
  "abandoned",
]);

export const feeStrategyEnum = pgEnum("fee_strategy", [
  "organizer_absorbs",
  "buyer_pays",
]);

// Who carries a given fee. Used for the platform's own cut; the card fee
// still uses feeStrategyEnum above.
export const feeBearerEnum = pgEnum("fee_bearer", ["organizer", "buyer"]);

export const payoutStatusEnum = pgEnum("payout_status", [
  "pending",
  "processing",
  "paid",
  "failed",
]);

export const checkInMethodEnum = pgEnum("check_in_method", [
  "qr_scan",
  "manual_lookup",
]);

// The question types an organiser can add to their own checkout form.
export const registrationFieldKindEnum = pgEnum("registration_field_kind", [
  "short_text",
  "paragraph",
  "choice",
  "checkboxes",
  "dropdown",
  "number",
  "phone",
  "date",
]);

// Two things that look identical at checkout and are opposites in the ledger:
// a discount means the buyer pays less; a referral means the buyer pays the
// same and somebody is owed a cut for bringing them.
export const promoCodeKindEnum = pgEnum("promo_code_kind", [
  "discount",
  "refer_to_earn",
]);

// ─── Core tables ─────────────────────────────────────────────────────────

// `users` = authenticated PLATFORM users only: Organization Owners, Event
// Managers, Gate Staff, Finance/Admin. Ticket buyers (attendees) are NOT
// required to have a User record — they check out as guests. See `orders`
// and `tickets` below for where guest attendee details actually live.
//
// firstName/lastName/passwordHash are nullable because Google sign-in only
// provides a single full name and no password — those users get `name`
// populated instead (required by the Auth.js Drizzle adapter's AdapterUser
// shape) and a null passwordHash, which the Credentials provider checks for
// and rejects (an OAuth-only account can't log in with a password).
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  firstName: varchar("first_name", { length: 100 }),
  lastName: varchar("last_name", { length: 100 }),
  name: varchar("name", { length: 200 }), // full name, mainly for OAuth signups
  email: varchar("email", { length: 255 }).notNull().unique(),
  emailVerified: timestamp("email_verified"), // set by OAuth providers
  image: text("image"), // avatar URL from OAuth provider
  phone: varchar("phone", { length: 32 }),
  passwordHash: text("password_hash"),
  // Campus context. All nullable: platform staff and guest-turned-account
  // buyers have none, and a student can sign up before deciding to share it.
  universityId: uuid("university_id").references(() => universities.id, {
    onDelete: "set null",
  }),
  campusId: uuid("campus_id").references(() => campuses.id, {
    onDelete: "set null",
  }),
  departmentId: uuid("department_id").references(() => departments.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Required by the Auth.js Drizzle adapter to support OAuth providers
// (Google). Field names must match the adapter's expected shape exactly
// (userId, providerAccountId, etc.) — see @auth/drizzle-adapter's
// DefaultPostgresAccountsTable. Not used by the Credentials provider.
export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 50 }).notNull(),
    provider: varchar("provider", { length: 50 }).notNull(),
    providerAccountId: varchar("provider_account_id", { length: 255 }).notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: varchar("token_type", { length: 50 }),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: varchar("session_state", { length: 255 }),
  },
  (account) => ({
    uniqueProviderAccount: uniqueIndex("accounts_provider_unique").on(
      account.provider,
      account.providerAccountId
    ),
  })
);

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  slug: varchar("slug", { length: 200 }).notNull().unique(),
  ownerId: uuid("owner_id")
    .references(() => users.id)
    .notNull(),
  // There is no fee configuration here any more, and that is deliberate.
  //
  // This table used to carry fee_percent (defaulting to 8.00), fee_flat and
  // fee_strategy, with a comment explaining that pricing lived here so
  // changes would need no engineering. Nothing ever read them. Every real
  // calculation goes through PLATFORM_FEE_RATE in lib/fees.ts, which is 5%.
  //
  // Two numbers claiming to be the platform fee, one of them wrong and
  // sitting in the table a future reader would look in first, is a trap
  // rather than a feature: the day someone wires up the column believing it
  // to be live, every organiser's cut silently changes. A comment saying
  // "don't use this" does not survive contact with a new developer, so the
  // columns are gone. Per-organisation pricing, when it is real, gets a
  // deliberate design and a table nobody has to be warned about.
  /**
   * Where the money goes.
   *
   * Held here rather than on the user: the account belongs to the
   * organisation, so a committee that changes treasurer does not lose its
   * payout details along with the person.
   *
   * Stored as typed, not validated against the bank. Nigerian account
   * numbers are ten digits, but an organiser mistyping one is caught by the
   * transfer failing, not by us — and refusing to save a number we merely
   * dislike would leave them unable to request a payout at all.
   */
  bankName: varchar("bank_name", { length: 120 }),
  bankAccountName: varchar("bank_account_name", { length: 200 }),
  bankAccountNumber: varchar("bank_account_number", { length: 20 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" }),
    userEmail: varchar("user_email", { length: 255 }),
    role: orgRoleEnum("role").notNull(),
    status: varchar("status", { length: 50 }).default("active").notNull(),
    inviteToken: varchar("invite_token", { length: 255 }),
    invitedAt: timestamp("invited_at"),
    joinedAt: timestamp("joined_at"),
    invitedBy: varchar("invited_by", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    uniqueMembership: uniqueIndex("org_member_unique").on(
      t.organizationId,
      t.userId
    ),
  })
);

export const events = pgTable("events", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  slug: varchar("slug", { length: 200 }).notNull().unique(),
  description: text("description"),
  coverImage: text("cover_image"),
  /**
   * The organiser's own mark, as distinct from this event's flyer.
   *
   * coverImage is the poster for THIS party. logoUrl is the committee's
   * crest, and it belongs on every event they run, on the ticket, and in the
   * email. One column for both would mean re-uploading the crest for every
   * event, and a ticket carrying a flyer where a brand should be.
   */
  logoUrl: text("logo_url"),
  /**
   * Extra banner media, rotated on the event page. [{ kind, url }] where kind
   * is 'image' or 'youtube'.
   *
   * jsonb rather than a table: always read whole, always written whole, never
   * queried into. A gallery_items table would buy referential integrity over
   * strings nobody joins on, at the cost of a round trip per page load.
   */
  gallery: jsonb("gallery")
    .$type<{ kind: "image" | "youtube"; url: string }[]>()
    .default([])
    .notNull(),
  /** [{ name, logoUrl, url }] — shown as a strip on the public page. */
  sponsors: jsonb("sponsors")
    .$type<{ name: string; logoUrl: string; url?: string | null }[]>()
    .default([])
    .notNull(),
  /**
   * What buyers are told AFTER they pay — on the ticket page and in the
   * confirmation email, never on the public event page.
   *
   * This is the WhatsApp group link, the Zoom link, the "come through the
   * back gate after 8": the thing organisers currently send by DM to each
   * buyer individually, which is why whoever buys at 2am hears nothing until
   * morning. Kept private on purpose — a WhatsApp invite on an open page is a
   * WhatsApp group full of people who never bought a ticket.
   */
  afterPurchaseNote: text("after_purchase_note"),
  afterPurchaseUrl: text("after_purchase_url"),
  category: varchar("category", { length: 100 }),
  venueName: varchar("venue_name", { length: 200 }),
  venueAddress: text("venue_address"),
  city: varchar("city", { length: 100 }),
  country: varchar("country", { length: 100 }).default("Nigeria"),
  startDatetime: timestamp("start_datetime").notNull(),
  endDatetime: timestamp("end_datetime").notNull(),
  /**
   * "We haven't confirmed the date yet."
   *
   * The date above is still filled in — an organiser posting early nearly
   * always has a rough one, and a provisional date sorts the event into
   * roughly the right week, where somebody looking for it would think to
   * look. This flag means DON'T SHOW THAT NUMBER: the public page prints "to
   * be announced" instead, and the countdown stays quiet.
   *
   * Anything that displays a date has to check this first. That includes the
   * change-notification email, which reports the date as unannounced while
   * the flag is on — otherwise shuffling a provisional date would email
   * people about a date they were never shown.
   */
  dateTbd: boolean("date_tbd").default(false).notNull(),
  /**
   * Same idea for the venue, and separate from venueName being empty.
   *
   * A blank venue is ambiguous — "not decided" and "I'll come back to this"
   * look identical — and the publish rules have to tell them apart. An event
   * may go live with a venue that is openly to be announced; it may not go
   * live with one the organiser simply forgot.
   */
  venueTbd: boolean("venue_tbd").default(false).notNull(),
  salesStart: timestamp("sales_start"),
  salesEnd: timestamp("sales_end"),
  status: eventStatusEnum("status").default("draft").notNull(),
  // Who carries Paystack's processing charge.
  feeStrategy: feeStrategyEnum("fee_strategy").default("buyer_pays").notNull(),
  // Who carries our platform cut. Defaults to the organizer — the buyer
  // seeing the sticker price is the friendlier default for a student market
  // — but an organizer can pass it on.
  platformFeePaidBy: feeBearerEnum("platform_fee_paid_by")
    .default("organizer")
    .notNull(),
  // Which campus this belongs to, for "what's on around me".
  //
  // Both nullable, and they stay nullable. A Lagos comedy night posted
  // through a public link belongs to no university, and every event that
  // existed before this column did belongs to none either. Discovery treats
  // null as "everyone's", never as "nobody's" — an event does not vanish
  // from the listing because its organiser skipped a field. The reference
  // is `set null` for the same reason: deleting a campus record must not
  // take real events with it.
  universityId: uuid("university_id").references(() => universities.id, {
    onDelete: "set null",
  }),
  campusId: uuid("campus_id").references(() => campuses.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const ticketTypes = pgTable("ticket_types", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id")
    .references(() => events.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("NGN").notNull(),
  quantityTotal: integer("quantity_total").notNull(),
  quantitySold: integer("quantity_sold").default(0).notNull(),
  quantityReserved: integer("quantity_reserved").default(0).notNull(), // held during active checkout
  salesStart: timestamp("sales_start"),
  salesEnd: timestamp("sales_end"),
  maxPerOrder: integer("max_per_order").default(10).notNull(),
  /**
   * How many people one ticket lets through the door.
   *
   * A table of six, a couple's entry, a hostel block buying together. An
   * `admits` count rather than an is_group flag plus a size, because a flag
   * that can disagree with the number beside it eventually will.
   *
   * IMPORTANT for anyone doing capacity maths: quantityTotal counts TICKETS.
   * With admits = 6, a quantityTotal of 20 is twenty tables and one hundred
   * and twenty seats. Check-in has to let six people in on one scan.
   */
  admits: integer("admits").default(1).notNull(),
  /**
   * A discount the organiser starts by hand and that expires by itself.
   *
   * Not an early-bird tier — an early-bird is a decision made weeks ahead.
   * This is the lever you pull on Thursday when Saturday is half sold.
   *
   * Stored as two timestamps rather than "started + N hours" so every check
   * is a plain comparison, and so ending one early is an update of
   * flashEndsAt to now() rather than arithmetic in three different places.
   */
  flashKind: varchar("flash_kind", { length: 10 }).$type<"percent" | "amount">(),
  flashValue: numeric("flash_value", { precision: 12, scale: 2 }),
  flashStartsAt: timestamp("flash_starts_at"),
  flashEndsAt: timestamp("flash_ends_at"),
  status: ticketTypeStatusEnum("status").default("active").notNull(),
});

/**
 * Codes somebody types at checkout.
 *
 * One table for two opposite things, because mechanically they are the same —
 * a string, a percentage, a usage limit, a count — and because an organiser
 * typing a code into the same box twice shouldn't have to know which of our
 * tables it landed in.
 *
 *   discount      — the buyer pays less. Costs the organiser now.
 *   refer_to_earn — the buyer pays the same, and somebody is owed a cut for
 *                   bringing them. Costs the organiser later.
 */
export const promoCodes = pgTable(
  "promo_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .references(() => events.id, { onDelete: "cascade" })
      .notNull(),
    kind: promoCodeKindEnum("kind").notNull(),
    code: varchar("code", { length: 32 }).notNull(),
    /** What the organiser calls it in their own dashboard. */
    label: varchar("label", { length: 120 }),
    /**
     * refer_to_earn only: who is owed.
     *
     * A name, not an account. Most people selling tickets for a campus party
     * will never sign up for anything, and requiring them to is how a
     * referral programme ends up with no referrers.
     */
    promoterName: varchar("promoter_name", { length: 120 }),
    /**
     * ...but when the promoter IS someone on the team, this points at their
     * staff row so /promote can show them their own numbers. Forward
     * reference: eventStaff is defined further down, hence the annotation.
     */
    staffId: uuid("staff_id").references((): AnyPgColumn => eventStaff.id, {
      onDelete: "set null",
    }),
    /** Percent. % off for a discount, % commission for a referral. */
    rate: numeric("rate", { precision: 5, scale: 2 }).default("0").notNull(),
    /** Null means unlimited. */
    usageLimit: integer("usage_limit"),
    usedCount: integer("used_count").default(0).notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    // Declared on the plain columns here; the real index in 0011 is on
    // upper(code). Matching is case-insensitive — nobody types SUMMER20 the
    // way you wrote it down — so uniqueness has to be case-insensitive too,
    // or the second "summer20" on an event becomes a coin flip at checkout.
    uniquePerEvent: uniqueIndex("promo_codes_event_code_idx").on(
      t.eventId,
      t.code
    ),
  })
);

export const orders = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id")
    .references(() => events.id)
    .notNull(),
  // Nullable by design: attendees check out as GUESTS in V1. buyerId is only
  // populated if a logged-in platform user (e.g. an organizer buying their
  // own ticket) happens to place the order. Contact details below are the
  // source of truth for who bought the ticket, independent of any account.
  buyerId: uuid("buyer_id").references(() => users.id),
  email: varchar("email", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 32 }).notNull(),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
  fees: numeric("fees", { precision: 12, scale: 2 }).notNull(),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("NGN").notNull(),
  status: orderStatusEnum("status").default("pending").notNull(),
  /**
   * Who sold it, when somebody did.
   *
   * Points at the user rather than the staff row so attribution survives the
   * promoter being removed from the event afterwards — the sale still
   * happened, and a payout argument three weeks later is exactly when this
   * gets looked up. `set null` rather than cascade for the same reason: if
   * the account is deleted the order stays, it simply stops naming anyone.
   */
  promoterId: uuid("promoter_id").references(() => users.id, {
    onDelete: "set null",
  }),
  /** Which code was typed at checkout, if any. */
  promoCodeId: uuid("promo_code_id").references(() => promoCodes.id, {
    onDelete: "set null",
  }),
  /**
   * What that code took off — stored, not recomputed.
   *
   * The code's rate can be edited afterwards; what a buyer was actually
   * charged cannot. An order is a receipt.
   */
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 })
    .default("0")
    .notNull(),
  /**
   * What a promoter earned on this order, in naira, frozen at checkout.
   *
   * Same argument as discountAmount, with more force: this is money owed to
   * a person. An organiser who drops a code from 10% to 5% in March must not
   * silently reduce what they owe for February. `promoCodes.rate` governs
   * new sales; this is what the old ones actually earned.
   */
  commissionAmount: numeric("commission_amount", { precision: 12, scale: 2 })
    .default("0")
    .notNull(),
  paymentReference: varchar("payment_reference", { length: 100 }).unique(),
  reservationExpiresAt: timestamp("reservation_expires_at"), // inventory hold deadline
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * The extra questions an organiser puts on their own checkout form.
 *
 * The most valuable thing on this list, and more valuable to us than to the
 * general ticketing sites it was borrowed from. They offer custom fields and
 * get "shirt size". We already know which university an event belongs to, so
 * an organiser asking for a matric number is asking the one question that
 * proves the room is full of students — which is the entire premise here.
 */
export const registrationFields = pgTable(
  "registration_fields",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .references(() => events.id, { onDelete: "cascade" })
      .notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    kind: registrationFieldKindEnum("kind").default("short_text").notNull(),
    /** Only meaningful for choice / checkboxes / dropdown. */
    options: jsonb("options").$type<string[]>().default([]).notNull(),
    required: boolean("required").default(false).notNull(),
    /**
     * Explicit rather than relying on insertion order: the organiser will
     * drag these around and expect the checkout form to agree.
     */
    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    byEvent: index("registration_fields_event_idx").on(t.eventId, t.position),
  })
);

/**
 * One row per question per order.
 *
 * `label` is COPIED here rather than joined from the field. An organiser who
 * renames "Matric number" to "Student ID" halfway through selling must not
 * silently relabel four hundred answers given to the old question, and
 * deleting a question must not delete the answers people already gave. Same
 * reasoning as the bank details copied onto a payout: this is a record of
 * what happened, not a view of what is currently configured.
 */
export const registrationAnswers = pgTable(
  "registration_answers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .references(() => orders.id, { onDelete: "cascade" })
      .notNull(),
    eventId: uuid("event_id")
      .references(() => events.id, { onDelete: "cascade" })
      .notNull(),
    fieldId: uuid("field_id").references(() => registrationFields.id, {
      onDelete: "set null",
    }),
    label: varchar("label", { length: 120 }).notNull(),
    value: text("value"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    byEvent: index("registration_answers_event_idx").on(t.eventId),
    byOrder: index("registration_answers_order_idx").on(t.orderId),
  })
);

export const tickets = pgTable("tickets", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .references(() => orders.id, { onDelete: "cascade" })
    .notNull(),
  eventId: uuid("event_id")
    .references(() => events.id)
    .notNull(),
  ticketTypeId: uuid("ticket_type_id")
    .references(() => ticketTypes.id)
    .notNull(),
  // Attendee identity lives here, not on a User record — this is who holds
  // the ticket, regardless of whether the buyer has (or is) an account.
  attendeeName: varchar("attendee_name", { length: 200 }).notNull(),
  attendeeEmail: varchar("attendee_email", { length: 255 }).notNull(),
  qrToken: varchar("qr_token", { length: 128 }).notNull().unique(), // cryptographically random, opaque
  status: ticketStatusEnum("status").default("pending").notNull(),
  checkedInAt: timestamp("checked_in_at"),
  checkedInBy: uuid("checked_in_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .references(() => orders.id, { onDelete: "cascade" })
    .notNull(),
  provider: varchar("provider", { length: 50 }).default("paystack").notNull(),
  providerReference: varchar("provider_reference", { length: 150 })
    .notNull()
    .unique(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("NGN").notNull(),
  status: paymentStatusEnum("status").default("initialized").notNull(),
  paidAt: timestamp("paid_at"),
  rawProviderResponse: jsonb("raw_provider_response"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const checkIns = pgTable("check_ins", {
  id: uuid("id").defaultRandom().primaryKey(),
  ticketId: uuid("ticket_id")
    .references(() => tickets.id, { onDelete: "cascade" })
    .notNull(),
  eventId: uuid("event_id")
    .references(() => events.id)
    .notNull(),
  checkedInBy: uuid("checked_in_by").references(() => users.id),
  checkedInAt: timestamp("checked_in_at").defaultNow().notNull(),
  method: checkInMethodEnum("method").default("qr_scan").notNull(),
});

export const payouts = pgTable("payouts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id)
    .notNull(),
  eventId: uuid("event_id").references(() => events.id),
  grossAmount: numeric("gross_amount", { precision: 12, scale: 2 }).notNull(),
  platformFee: numeric("platform_fee", { precision: 12, scale: 2 }).notNull(),
  paymentProcessingFee: numeric("payment_processing_fee", {
    precision: 12,
    scale: 2,
  }).notNull(),
  netAmount: numeric("net_amount", { precision: 12, scale: 2 }).notNull(),
  status: payoutStatusEnum("status").default("pending").notNull(),
  /**
   * A snapshot of where the money was going when the request was made.
   *
   * Copied rather than joined: an organiser who changes bank account after
   * requesting a payout must not have the record of the old request quietly
   * rewritten to point at the new one. This is the row somebody reads when a
   * transfer goes astray.
   */
  bankName: varchar("bank_name", { length: 120 }),
  bankAccountName: varchar("bank_account_name", { length: 200 }),
  bankAccountNumber: varchar("bank_account_number", { length: 20 }),
  /** Who asked. */
  requestedBy: uuid("requested_by").references(() => users.id, {
    onDelete: "set null",
  }),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  /** Set when a request is refused, so the organiser is told why. */
  note: text("note"),
  paidAt: timestamp("paid_at"),
});

// ─── Relations (for Drizzle's relational query API) ─────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  organizations: many(organizations),
  memberships: many(organizationMembers),
}));

export const organizationsRelations = relations(
  organizations,
  ({ one, many }) => ({
    owner: one(users, {
      fields: [organizations.ownerId],
      references: [users.id],
    }),
    members: many(organizationMembers),
    events: many(events),
  })
);

export const eventsRelations = relations(events, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [events.organizationId],
    references: [organizations.id],
  }),
  ticketTypes: many(ticketTypes),
  orders: many(orders),
  registrationFields: many(registrationFields),
  promoCodes: many(promoCodes),
}));

export const ticketTypesRelations = relations(ticketTypes, ({ one, many }) => ({
  event: one(events, {
    fields: [ticketTypes.eventId],
    references: [events.id],
  }),
  tickets: many(tickets),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  event: one(events, { fields: [orders.eventId], references: [events.id] }),
  buyer: one(users, { fields: [orders.buyerId], references: [users.id] }),
  promoCode: one(promoCodes, {
    fields: [orders.promoCodeId],
    references: [promoCodes.id],
  }),
  tickets: many(tickets),
  payments: many(payments),
  answers: many(registrationAnswers),
}));

export const promoCodesRelations = relations(promoCodes, ({ one, many }) => ({
  event: one(events, { fields: [promoCodes.eventId], references: [events.id] }),
  orders: many(orders),
}));

export const registrationFieldsRelations = relations(
  registrationFields,
  ({ one, many }) => ({
    event: one(events, {
      fields: [registrationFields.eventId],
      references: [events.id],
    }),
    answers: many(registrationAnswers),
  })
);

export const registrationAnswersRelations = relations(
  registrationAnswers,
  ({ one }) => ({
    order: one(orders, {
      fields: [registrationAnswers.orderId],
      references: [orders.id],
    }),
    event: one(events, {
      fields: [registrationAnswers.eventId],
      references: [events.id],
    }),
    field: one(registrationFields, {
      fields: [registrationAnswers.fieldId],
      references: [registrationFields.id],
    }),
  })
);

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  order: one(orders, { fields: [tickets.orderId], references: [orders.id] }),
  event: one(events, { fields: [tickets.eventId], references: [events.id] }),
  ticketType: one(ticketTypes, {
    fields: [tickets.ticketTypeId],
    references: [ticketTypes.id],
  }),
  checkIns: many(checkIns),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
}));

// ─── Campus context ──────────────────────────────────────────────────────
//
// Kept deliberately thin: university → campus → faculty → department, and
// nothing below that. A student belongs to a university and optionally a
// department; an event happens at a campus. Anything more elaborate would be
// modelling a university's org chart rather than what discovery needs.

export const universities = pgTable("universities", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  shortName: varchar("short_name", { length: 40 }).notNull(),
  slug: varchar("slug", { length: 200 }).notNull().unique(),
  state: varchar("state", { length: 100 }),
  country: varchar("country", { length: 100 }).default("Nigeria").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const campuses = pgTable(
  "campuses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    universityId: uuid("university_id")
      .references(() => universities.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    slug: varchar("slug", { length: 200 }).notNull(),
    city: varchar("city", { length: 100 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    uniqueCampus: uniqueIndex("campus_unique").on(t.universityId, t.slug),
  })
);

export const faculties = pgTable(
  "faculties",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    universityId: uuid("university_id")
      .references(() => universities.id, { onDelete: "cascade" })
      .notNull(),
    // Nullable: a faculty we know exists but cannot confidently place on a
    // campus is still useful, and guessing would be worse than admitting it.
    campusId: uuid("campus_id").references(() => campuses.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 200 }).notNull(),
    slug: varchar("slug", { length: 200 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    uniqueFaculty: uniqueIndex("faculty_unique").on(t.universityId, t.slug),
  })
);

// Departments seeded from public directories are marked `provisional`: no
// published list agreed with any other, so the seed is a starting point and
// students correct it. One a student types themselves arrives as `pending`
// and is reviewed before it shows up in anyone else's picker — otherwise a
// typo becomes a permanent option for the whole university.
export const departmentStatusEnum = pgEnum("department_status", [
  "confirmed",
  "provisional",
  "pending",
  "rejected",
]);

export const departments = pgTable(
  "departments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    universityId: uuid("university_id")
      .references(() => universities.id, { onDelete: "cascade" })
      .notNull(),
    // Nullable on purpose: several real programmes could not be attributed
    // to a faculty from any source, and an invented attribution is worse
    // than an empty field an admin can fill in.
    facultyId: uuid("faculty_id").references(() => faculties.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 200 }).notNull(),
    slug: varchar("slug", { length: 200 }).notNull(),
    status: departmentStatusEnum("status").default("provisional").notNull(),
    // Who suggested it, when it came from a student rather than the seed.
    // Deliberately NOT a declared foreign key: users.department_id already
    // points at this table, and adding a reference back to users closes a
    // cycle that Drizzle's type inference cannot resolve — it silently
    // widens every relational query in the app to `any`, which showed up as
    // the admin console losing its types rather than as an error here.
    suggestedBy: uuid("suggested_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    uniqueDepartment: uniqueIndex("department_unique").on(
      t.universityId,
      t.slug
    ),
  })
);

export const universitiesRelations = relations(universities, ({ many }) => ({
  campuses: many(campuses),
  faculties: many(faculties),
  departments: many(departments),
}));

export const campusesRelations = relations(campuses, ({ one, many }) => ({
  university: one(universities, {
    fields: [campuses.universityId],
    references: [universities.id],
  }),
  faculties: many(faculties),
}));

export const facultiesRelations = relations(faculties, ({ one, many }) => ({
  university: one(universities, {
    fields: [faculties.universityId],
    references: [universities.id],
  }),
  campus: one(campuses, {
    fields: [faculties.campusId],
    references: [campuses.id],
  }),
  departments: many(departments),
}));

export const departmentsRelations = relations(departments, ({ one }) => ({
  university: one(universities, {
    fields: [departments.universityId],
    references: [universities.id],
  }),
  faculty: one(faculties, {
    fields: [departments.facultyId],
    references: [faculties.id],
  }),
}));

// ─── Per-event staffing ──────────────────────────────────────────────────
//
// Organization membership says who belongs to the company; this table says
// who works a *specific* event and in what capacity. A gate volunteer hired
// for one show should not be able to scan tickets at the next one, which is
// exactly what an organization-wide role would have allowed.
//
// The organization owner is deliberately absent here: ownership is a
// company-level fact and grants full access to every event the org runs.
export const eventStaff = pgTable(
  "event_staff",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .references(() => events.id, { onDelete: "cascade" })
      .notNull(),
    // Null until the invitee accepts and we can bind a real account.
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    userEmail: varchar("user_email", { length: 255 }).notNull(),
    role: orgRoleEnum("role").notNull(),
    status: varchar("status", { length: 50 }).default("pending").notNull(),
    /**
     * The promoter's own share code, e.g. /e/freshers-night?p=AMAKA7.
     *
     * Lives on the staff row rather than on the user, because the same
     * person promoting two events needs two codes — otherwise a sale can be
     * attributed to a person but not to the event they sold it for, which is
     * the only question anybody actually asks.
     *
     * Nullable: only promoters get one, and it is minted when the role is
     * assigned rather than for every gate volunteer.
     */
    refCode: varchar("ref_code", { length: 24 }),
    /**
     * The money switch, orthogonal to the role.
     *
     * An organiser deciding who helps is really answering two questions —
     * how much can this person change, and can they see the money — and
     * bundling them into role names meant guessing which combinations
     * people want. Off by default, because the safe answer to "should this
     * person see the payout account" is no until somebody says otherwise.
     *
     * Grants sight of revenue and payouts. It does NOT grant refunds:
     * moving money is an action, and a checkbox ticked in passing should
     * not be able to hand that out.
     */
    canSeeFinances: boolean("can_see_finances").default(false).notNull(),
    inviteToken: varchar("invite_token", { length: 255 }),
    invitedAt: timestamp("invited_at").defaultNow(),
    joinedAt: timestamp("joined_at"),
    invitedBy: varchar("invited_by", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    uniqueEventUser: uniqueIndex("event_staff_unique").on(t.eventId, t.userId),
  })
);

export const eventStaffRelations = relations(eventStaff, ({ one }) => ({
  event: one(events, {
    fields: [eventStaff.eventId],
    references: [events.id],
  }),
  user: one(users, { fields: [eventStaff.userId], references: [users.id] }),
}));

// ─── Refunds ─────────────────────────────────────────────────────────────
//
// Money leaving the system deserves its own record. Ticket and order status
// say *what* state something is in; this says who refunded what, when, for
// how much, and what the provider called it — the trail you need when an
// attendee disputes a charge months later.
export const refunds = pgTable("refunds", {
  id: uuid("id").defaultRandom().primaryKey(),
  ticketId: uuid("ticket_id")
    .references(() => tickets.id, { onDelete: "cascade" })
    .notNull(),
  orderId: uuid("order_id")
    .references(() => orders.id, { onDelete: "cascade" })
    .notNull(),
  eventId: uuid("event_id")
    .references(() => events.id, { onDelete: "cascade" })
    .notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("NGN").notNull(),
  reason: text("reason"),
  providerReference: varchar("provider_reference", { length: 150 }),
  providerResponse: jsonb("provider_response"),
  refundedBy: uuid("refunded_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const refundsRelations = relations(refunds, ({ one }) => ({
  ticket: one(tickets, { fields: [refunds.ticketId], references: [tickets.id] }),
  order: one(orders, { fields: [refunds.orderId], references: [orders.id] }),
  event: one(events, { fields: [refunds.eventId], references: [events.id] }),
}));

// ─── Conversation, updates and moderation ────────────────────────────────
//
// §11 of the build document: event-specific Q&A first, organiser updates,
// and "basic report/block/moderation controls are required once
// user-generated content is enabled". Required, not recommended — so the
// report table ships in the same migration as the message table, and the
// moderation endpoint in the same release as the composer. A product that
// can post before it can moderate is a product with a problem it cannot
// answer.

export const messageStatusEnum = pgEnum("message_status", [
  "visible",
  // Taken down by the event's organiser or an admin. The row survives so a
  // moderation decision can be reviewed and reversed, and so a reported
  // message cannot be made to disappear by deleting it.
  "hidden",
  // Withdrawn by its own author.
  "removed",
]);

export const eventMessages = pgTable(
  "event_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .references(() => events.id, { onDelete: "cascade" })
      .notNull(),
    // Cascades: if an account is deleted its posts go with it, which is what
    // a deletion request means.
    authorId: uuid("author_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    // One level of replies. Threading deeper turns an event's Q&A into a
    // forum, and §11 rules that out for V1. The self-reference needs the
    // AnyPgColumn annotation or TypeScript cannot resolve the type of a
    // table being defined in terms of itself.
    parentId: uuid("parent_id").references((): AnyPgColumn => eventMessages.id, {
      onDelete: "cascade",
    }),
    body: text("body").notNull(),
    status: messageStatusEnum("status").default("visible").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    // The listing query is always "this event, newest first".
    byEvent: index("event_messages_event_idx").on(t.eventId, t.createdAt),
    byParent: index("event_messages_parent_idx").on(t.parentId),
  })
);

// Organiser announcements — "the venue don change", "doors open by 7".
// Deliberately a separate table from messages rather than a flag on one:
// an update is broadcast and cannot be replied to, a message is a
// conversation, and merging them means every read has to filter.
export const eventUpdates = pgTable(
  "event_updates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .references(() => events.id, { onDelete: "cascade" })
      .notNull(),
    // Not cascaded and not null-able away: an announcement outlives the
    // staff account that posted it, so this holds the id without demanding
    // the row still exist.
    authorId: uuid("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    byEvent: index("event_updates_event_idx").on(t.eventId, t.createdAt),
  })
);

export const reportReasonEnum = pgEnum("report_reason", [
  "spam",
  "abuse",
  "scam",
  "off_topic",
  "other",
]);

export const reportStatusEnum = pgEnum("report_status", [
  "open",
  "actioned",
  "dismissed",
]);

export const messageReports = pgTable(
  "message_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageId: uuid("message_id")
      .references(() => eventMessages.id, { onDelete: "cascade" })
      .notNull(),
    reporterId: uuid("reporter_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    reason: reportReasonEnum("reason").notNull(),
    note: text("note"),
    status: reportStatusEnum("status").default("open").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    // One report per person per message. Without this, a handful of people
    // can run up a count that looks like a pile-on, and the same person can
    // report the same post fifty times.
    oncePerReporter: uniqueIndex("message_report_unique").on(
      t.messageId,
      t.reporterId
    ),
    byStatus: index("message_reports_status_idx").on(t.status, t.createdAt),
  })
);

export const eventMessagesRelations = relations(eventMessages, ({ one }) => ({
  event: one(events, {
    fields: [eventMessages.eventId],
    references: [events.id],
  }),
  author: one(users, {
    fields: [eventMessages.authorId],
    references: [users.id],
  }),
  // No parent/children relation declared on purpose. A self-relation has to
  // be named on both sides, and a mis-declared cycle here silently widens
  // every relational query in the app to `any` — which is exactly what
  // departments.suggested_by did earlier in this build. Replies are grouped
  // by parentId in application code, which costs nothing at this scale.
}));

export const eventUpdatesRelations = relations(eventUpdates, ({ one }) => ({
  event: one(events, {
    fields: [eventUpdates.eventId],
    references: [events.id],
  }),
  author: one(users, {
    fields: [eventUpdates.authorId],
    references: [users.id],
  }),
}));

export const messageReportsRelations = relations(messageReports, ({ one }) => ({
  message: one(eventMessages, {
    fields: [messageReports.messageId],
    references: [eventMessages.id],
  }),
  reporter: one(users, {
    fields: [messageReports.reporterId],
    references: [users.id],
  }),
}));

// Barred from an event's conversation.
//
// Hiding messages one at a time is moderation for a bad post; this is
// moderation for a person who keeps making them. Without it "block" in §11
// is just a word — an organiser can take down a comment and watch the same
// account write it again a minute later.
//
// Scoped to one event on purpose. An organiser earns the right to police
// their own event's thread, not to bar a student from the platform; that
// decision belongs to an admin and to a different table.
export const eventBans = pgTable(
  "event_bans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .references(() => events.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    reason: text("reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    oncePerEvent: uniqueIndex("event_ban_unique").on(t.eventId, t.userId),
  })
);
