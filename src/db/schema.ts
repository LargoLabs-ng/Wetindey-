import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Enums ───────────────────────────────────────────────────────────────

export const orgRoleEnum = pgEnum("org_role", [
  "owner",
  "event_manager",
  "gate_staff",
  "finance",
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
  // Platform fee config lives here so pricing changes never require engineering work.
  // NOTE: dead column. Nothing reads fee_percent / fee_flat / fee_strategy —
  // every calculation uses PLATFORM_FEE_RATE in lib/fees.ts. Wiring these up
  // would silently change what every organizer is charged, so they stay
  // unread until per-organization pricing is a deliberate feature.
  feePercent: numeric("fee_percent", { precision: 5, scale: 2 })
    .default("8.00")
    .notNull(),
  feeFlat: numeric("fee_flat", { precision: 12, scale: 2 }).default("0.00").notNull(),
  feeStrategy: feeStrategyEnum("fee_strategy").default("buyer_pays").notNull(),
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
  category: varchar("category", { length: 100 }),
  venueName: varchar("venue_name", { length: 200 }),
  venueAddress: text("venue_address"),
  city: varchar("city", { length: 100 }),
  country: varchar("country", { length: 100 }).default("Nigeria"),
  startDatetime: timestamp("start_datetime").notNull(),
  endDatetime: timestamp("end_datetime").notNull(),
  salesStart: timestamp("sales_start"),
  salesEnd: timestamp("sales_end"),
  status: eventStatusEnum("status").default("draft").notNull(),
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
  status: ticketTypeStatusEnum("status").default("active").notNull(),
});

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
  paymentReference: varchar("payment_reference", { length: 100 }).unique(),
  reservationExpiresAt: timestamp("reservation_expires_at"), // inventory hold deadline
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
  tickets: many(tickets),
  payments: many(payments),
}));

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
