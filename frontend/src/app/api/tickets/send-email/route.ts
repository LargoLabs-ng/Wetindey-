import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { requireEventCapability } from "@/lib/authz";
import { sendTicketsForOrder } from "@/lib/ticket-email";

/**
 * POST /api/tickets/send-email — { orderId }
 * Resend an order's tickets. Organizer-only: the caller must belong to the
 * organization running the event. The purchase flow no longer calls this;
 * the Paystack webhook sends tickets by calling sendTicketsForOrder directly.
 */
export async function POST(request: NextRequest) {
  try {
    const { orderId } = await request.json().catch(() => ({}));

    if (!orderId) {
      return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
    }

    const [order] = await db
      .select({ eventId: orders.eventId })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const access = await requireEventCapability(order.eventId, 'attendees:view');
    if (!access.ok) {
      return NextResponse.json(
        { error: access.error },
        { status: access.status }
      );
    }

    const result = await sendTicketsForOrder(orderId);
    if (!result.ok) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: "Confirmation email sent",
      emailSent: result.emailSent,
    });
  } catch (error) {
    console.error("Error sending ticket email:", error);
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }
}
