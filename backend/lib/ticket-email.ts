import QRCode from "qrcode";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { sendOrderConfirmation } from "@/lib/email-service";

export type SendTicketsResult =
  | { ok: true; emailSent: boolean; eventId: string }
  | { ok: false; reason: "not_found" };

/**
 * Builds the QR codes for an order's tickets and emails them to the buyer.
 *
 * This lives in lib rather than the API route so the Paystack webhook can
 * call it directly instead of making an HTTP request back into the app —
 * that round trip depended on NEXT_PUBLIC_APP_URL being set correctly and
 * left the endpoint open to anyone who could guess an order id.
 */
export async function sendTicketsForOrder(
  orderId: string
): Promise<SendTicketsResult> {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    // The organisation comes along for the email header: the committee's
    // logo and name, not ours.
    with: { event: { with: { organization: true } }, tickets: true },
  });

  if (!order) return { ok: false, reason: "not_found" };

  const ticketsWithQR = await Promise.all(
    order.tickets.map(async (ticket) => {
      const qrValue = JSON.stringify({
        ticketId: ticket.id,
        token: ticket.qrToken || "",
        attendeeName: ticket.attendeeName || "Attendee",
        eventTitle: order.event.title,
        timestamp: new Date().toISOString(),
      });

      const qrCode = await QRCode.toDataURL(qrValue, {
        errorCorrectionLevel: "H",
        type: "image/png",
        margin: 1,
        color: { dark: "#12372A", light: "#ffffff" },
      });

      return {
        id: ticket.id,
        attendeeName: ticket.attendeeName || "Attendee",
        qrCode,
        ticketType: "Standard",
      };
    })
  );

  const start = new Date(order.event.startDatetime);

  const emailSent = await sendOrderConfirmation({
    attendeeEmail: order.email || "",
    attendeeFirstName: (order.email || "").split("@")[0] || "Customer",
    eventTitle: order.event.title,
    eventDate: start.toLocaleDateString("en-NG", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
    eventTime: start.toLocaleTimeString("en-NG", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    eventVenue: order.event.venueName || "TBA",
    eventCity: order.event.city || "TBA",
    tickets: ticketsWithQR,
    orderId: order.id,
    totalAmount: Number.isFinite(Number(order.total)) ? Number(order.total) : 0,
    // This email is the durable copy. The confirmation page shows the same
    // thing, but it's gone the moment they close the tab — and somebody
    // buying at 2am is exactly the person who needs the group link at 9am.
    afterPurchase: {
      note: order.event.afterPurchaseNote,
      url: order.event.afterPurchaseUrl,
    },
    organiserLogoUrl: order.event.logoUrl,
    organiserName: order.event.organization?.name ?? null,
  });

  if (!emailSent) {
    console.error(`Failed to send confirmation email for order ${orderId}`);
  }

  return { ok: true, emailSent, eventId: order.eventId };
}
