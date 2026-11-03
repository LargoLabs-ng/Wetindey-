import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  crmContactPreferences,
  crmContactTags,
  crmTags,
  events,
  orders,
  organizations,
  refunds,
  registrationAnswers,
  ticketTypes,
  tickets,
} from "@/db/schema";
import { getSessionUserId } from "@/lib/authz";

const createTagSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
});

const deleteTagSchema = z.object({ tagId: z.string().uuid() });

const updateContactSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["assign-tag", "remove-tag"]),
    email: z.string().trim().email().max(255),
    tagId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("opt-out"),
    email: z.string().trim().email().max(255),
    organizationId: z.string().uuid(),
  }),
]);

async function getOwnerOrganizations(userId: string) {
  return db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.ownerId, userId));
}

export async function GET() {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ownerOrganizations = await getOwnerOrganizations(userId);
    if (ownerOrganizations.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const organizationIds = ownerOrganizations.map((organization) => organization.id);
    const eventRows = await db
      .select({
        id: events.id,
        organizationId: events.organizationId,
        title: events.title,
      })
      .from(events)
      .where(inArray(events.organizationId, organizationIds));
    const eventById = new Map(eventRows.map((event) => [event.id, event]));
    const eventIds = eventRows.map((event) => event.id);

    const tagRows = await db
      .select({
        id: crmTags.id,
        organizationId: crmTags.organizationId,
        name: crmTags.name,
      })
      .from(crmTags)
      .where(inArray(crmTags.organizationId, organizationIds));

    if (eventIds.length === 0) {
      return NextResponse.json({
        organizations: ownerOrganizations,
        tags: tagRows,
        contacts: [],
      });
    }

    const orderRows = await db
      .select({
        id: orders.id,
        eventId: orders.eventId,
        email: orders.email,
        phone: orders.phone,
        total: orders.total,
        status: orders.status,
        marketingConsent: orders.marketingConsent,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(
        and(
          inArray(orders.eventId, eventIds),
          inArray(orders.status, ["paid", "refunded"])
        )
      );

    const orderIds = orderRows.map((order) => order.id);
    if (orderIds.length === 0) {
      return NextResponse.json({
        organizations: ownerOrganizations,
        tags: tagRows,
        contacts: [],
      });
    }

    const [ticketRows, answerRows, refundRows, tagAssignments, preferenceRows] =
      await Promise.all([
        db
          .select({
            id: tickets.id,
            orderId: tickets.orderId,
            attendeeName: tickets.attendeeName,
            attendeeEmail: tickets.attendeeEmail,
            ticketTypeId: tickets.ticketTypeId,
            status: tickets.status,
            checkedInAt: tickets.checkedInAt,
          })
          .from(tickets)
          .where(inArray(tickets.orderId, orderIds)),
        db
          .select({
            orderId: registrationAnswers.orderId,
            label: registrationAnswers.label,
            value: registrationAnswers.value,
          })
          .from(registrationAnswers)
          .where(inArray(registrationAnswers.orderId, orderIds)),
        db
          .select({
            orderId: refunds.orderId,
            amount: refunds.amount,
            status: refunds.status,
            reason: refunds.reason,
            createdAt: refunds.createdAt,
          })
          .from(refunds)
          .where(inArray(refunds.orderId, orderIds)),
        db
          .select({
            email: crmContactTags.email,
            tagId: crmTags.id,
            organizationId: crmTags.organizationId,
          })
          .from(crmContactTags)
          .innerJoin(crmTags, eq(crmContactTags.tagId, crmTags.id))
          .where(inArray(crmTags.organizationId, organizationIds)),
        db
          .select({
            email: crmContactPreferences.email,
            organizationId: crmContactPreferences.organizationId,
          })
          .from(crmContactPreferences)
          .where(inArray(crmContactPreferences.organizationId, organizationIds)),
      ]);

    const ticketTypeIds = [...new Set(ticketRows.map((ticket) => ticket.ticketTypeId))];
    const ticketTypeRows =
      ticketTypeIds.length > 0
        ? await db
            .select({ id: ticketTypes.id, name: ticketTypes.name })
            .from(ticketTypes)
            .where(inArray(ticketTypes.id, ticketTypeIds))
        : [];
    const ticketTypeName = new Map(
      ticketTypeRows.map((ticketType) => [ticketType.id, ticketType.name])
    );
    const ticketsByOrder = new Map<string, typeof ticketRows>();
    for (const ticket of ticketRows) {
      ticketsByOrder.set(ticket.orderId, [
        ...(ticketsByOrder.get(ticket.orderId) ?? []),
        ticket,
      ]);
    }
    const answersByOrder = new Map<string, typeof answerRows>();
    for (const answer of answerRows) {
      answersByOrder.set(answer.orderId, [
        ...(answersByOrder.get(answer.orderId) ?? []),
        answer,
      ]);
    }
    const refundsByOrder = new Map<string, typeof refundRows>();
    for (const refund of refundRows) {
      refundsByOrder.set(refund.orderId, [
        ...(refundsByOrder.get(refund.orderId) ?? []),
        refund,
      ]);
    }

    type Contact = {
      email: string;
      phone: string;
      orderCount: number;
      ticketCount: number;
      spend: number;
      lastPurchaseAt: string;
      organizations: Map<
        string,
        {
          id: string;
          name: string;
          marketingConsent: boolean;
          optedOut: boolean;
          tags: string[];
        }
      >;
      history: Array<{
        eventId: string;
        eventTitle: string;
        organizationId: string;
        purchasedAt: string;
        orderStatus: string;
        total: number;
        tickets: Array<{
          name: string;
          email: string;
          type: string;
          status: string;
          checkedInAt: string | null;
        }>;
        answers: Array<{ label: string; value: string }>;
        refunds: Array<{
          amount: number;
          status: string;
          reason: string | null;
          createdAt: string;
        }>;
      }>;
    };

    const contacts = new Map<string, Contact>();
    for (const order of orderRows) {
      const event = eventById.get(order.eventId);
      if (!event) continue;

      const email = order.email.trim().toLowerCase();
      const organization = ownerOrganizations.find(
        (item) => item.id === event.organizationId
      );
      if (!organization) continue;

      let contact = contacts.get(email);
      if (!contact) {
        contact = {
          email,
          phone: order.phone,
          orderCount: 0,
          ticketCount: 0,
          spend: 0,
          lastPurchaseAt: order.createdAt.toISOString(),
          organizations: new Map(),
          history: [],
        };
        contacts.set(email, contact);
      }

      let contactOrganization = contact.organizations.get(organization.id);
      if (!contactOrganization) {
        contactOrganization = {
          id: organization.id,
          name: organization.name,
          marketingConsent: false,
          optedOut: false,
          tags: [],
        };
        contact.organizations.set(organization.id, contactOrganization);
      }

      contact.orderCount += 1;
      const orderDate = order.createdAt.toISOString();
      if (orderDate > contact.lastPurchaseAt) {
        contact.lastPurchaseAt = orderDate;
        contact.phone = order.phone;
      }
      if (order.status === "paid") {
        contact.spend += Number(order.total);
      }
      contactOrganization.marketingConsent ||= order.marketingConsent;

      const orderTickets = ticketsByOrder.get(order.id) ?? [];
      contact.ticketCount += orderTickets.length;
      contact.history.push({
        eventId: event.id,
        eventTitle: event.title,
        organizationId: organization.id,
        purchasedAt: orderDate,
        orderStatus: order.status,
        total: Number(order.total),
        tickets: orderTickets.map((ticket) => ({
          name: ticket.attendeeName,
          email: ticket.attendeeEmail,
          type: ticketTypeName.get(ticket.ticketTypeId) ?? "Ticket",
          status: ticket.status,
          checkedInAt: ticket.checkedInAt?.toISOString() ?? null,
        })),
        answers: (answersByOrder.get(order.id) ?? []).map((answer) => ({
          label: answer.label,
          value: answer.value ?? "",
        })),
        refunds: (refundsByOrder.get(order.id) ?? []).map((refund) => ({
          amount: Number(refund.amount),
          status: refund.status,
          reason: refund.reason,
          createdAt: refund.createdAt.toISOString(),
        })),
      });
    }

    const preferenceKeys = new Set(
      preferenceRows.map(
        (preference) =>
          `${preference.organizationId}:${preference.email.trim().toLowerCase()}`
      )
    );
    for (const assignment of tagAssignments) {
      const contact = contacts.get(assignment.email.trim().toLowerCase());
      const organization = contact?.organizations.get(assignment.organizationId);
      const tag = tagRows.find((item) => item.id === assignment.tagId);
      if (organization && tag && !organization.tags.includes(tag.name)) {
        organization.tags.push(tag.name);
      }
    }
    for (const contact of contacts.values()) {
      for (const organization of contact.organizations.values()) {
        organization.optedOut = preferenceKeys.has(
          `${organization.id}:${contact.email}`
        );
        organization.marketingConsent =
          organization.marketingConsent && !organization.optedOut;
      }
      contact.history.sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt));
    }

    return NextResponse.json({
      organizations: ownerOrganizations,
      tags: tagRows,
      contacts: [...contacts.values()]
        .map((contact) => ({
          ...contact,
          organizations: [...contact.organizations.values()],
        }))
        .sort((a, b) => b.lastPurchaseAt.localeCompare(a.lastPurchaseAt)),
    });
  } catch (error) {
    console.error("Error fetching CRM contacts:", error);
    return NextResponse.json(
      { error: "Failed to fetch CRM contacts" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = createTagSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid tag details" }, { status: 400 });
    }

    const ownerOrganizations = await getOwnerOrganizations(userId);
    if (!ownerOrganizations.some((organization) => organization.id === parsed.data.organizationId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [tag] = await db
      .insert(crmTags)
      .values({
        organizationId: parsed.data.organizationId,
        name: parsed.data.name,
      })
      .returning({ id: crmTags.id, organizationId: crmTags.organizationId, name: crmTags.name });

    return NextResponse.json({ tag }, { status: 201 });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      return NextResponse.json(
        { error: "A tag with that name already exists for this organisation." },
        { status: 409 }
      );
    }
    console.error("Error creating CRM tag:", error);
    return NextResponse.json({ error: "Failed to create tag" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = updateContactSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid CRM update" }, { status: 400 });
    }

    const ownerOrganizations = await getOwnerOrganizations(userId);
    const organizationIds = ownerOrganizations.map((organization) => organization.id);
    if (organizationIds.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const email = parsed.data.email.toLowerCase();
    if (parsed.data.action === "opt-out") {
      if (!organizationIds.includes(parsed.data.organizationId)) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const [purchase] = await db
        .select({ id: orders.id })
        .from(orders)
        .innerJoin(events, eq(orders.eventId, events.id))
        .where(
          and(
            eq(events.organizationId, parsed.data.organizationId),
            eq(sql<string>`lower(${orders.email})`, email),
            inArray(orders.status, ["paid", "refunded"])
          )
        )
        .limit(1);
      if (!purchase) {
        return NextResponse.json({ error: "Contact not found" }, { status: 404 });
      }

      await db
        .insert(crmContactPreferences)
        .values({
          organizationId: parsed.data.organizationId,
          email,
          marketingOptOutAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [crmContactPreferences.organizationId, crmContactPreferences.email],
          set: { marketingOptOutAt: new Date() },
        });
      return NextResponse.json({ success: true });
    }

    const [tag] = await db
      .select({
        id: crmTags.id,
        organizationId: crmTags.organizationId,
      })
      .from(crmTags)
      .where(
        and(
          eq(crmTags.id, parsed.data.tagId),
          inArray(crmTags.organizationId, organizationIds)
        )
      )
      .limit(1);
    if (!tag) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    }

    const [purchase] = await db
      .select({ id: orders.id })
      .from(orders)
      .innerJoin(events, eq(orders.eventId, events.id))
      .where(
        and(
          eq(events.organizationId, tag.organizationId),
          eq(sql<string>`lower(${orders.email})`, email),
          inArray(orders.status, ["paid", "refunded"])
        )
      )
      .limit(1);
    if (!purchase) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    if (parsed.data.action === "assign-tag") {
      await db
        .insert(crmContactTags)
        .values({ tagId: tag.id, email })
        .onConflictDoNothing();
    } else {
      await db
        .delete(crmContactTags)
        .where(
          and(
            eq(crmContactTags.tagId, tag.id),
            eq(crmContactTags.email, email)
          )
        );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating CRM contact:", error);
    return NextResponse.json(
      { error: "Failed to update contact" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = deleteTagSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid tag" }, { status: 400 });
    }

    const ownerOrganizations = await getOwnerOrganizations(userId);
    const organizationIds = ownerOrganizations.map((organization) => organization.id);
    const [tag] = organizationIds.length
      ? await db
          .delete(crmTags)
          .where(
            and(
              eq(crmTags.id, parsed.data.tagId),
              inArray(crmTags.organizationId, organizationIds)
            )
          )
          .returning({ id: crmTags.id })
      : [];
    if (!tag) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting CRM tag:", error);
    return NextResponse.json({ error: "Failed to delete tag" }, { status: 500 });
  }
}
