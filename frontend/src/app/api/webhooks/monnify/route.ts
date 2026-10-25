import { NextRequest, NextResponse } from "next/server";
import { isMonnifyWebhookSignatureValid } from "@/lib/monnify";
import { verifyAndFinalizeMonnifyPayment } from "@/lib/monnify-payments";
import { updateMonnifyRefundStatus } from "@/lib/finalize-order";

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get("monnify-signature");
    const secret = process.env.MONNIFY_SECRET_KEY;
    const isProduction = process.env.MONNIFY_ENV === "production";

    if (signature) {
      if (!secret || !isMonnifyWebhookSignatureValid(body, signature, secret)) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    } else if (isProduction || !secret) {
      return NextResponse.json(
        { error: "Missing Monnify signature or secret" },
        { status: 401 }
      );
    }

    const event: unknown = JSON.parse(body);
    if (!event || typeof event !== "object") {
      return NextResponse.json({ error: "Invalid event payload" }, { status: 400 });
    }
    const eventData = "eventData" in event ? event.eventData : null;
    const eventType =
      "eventType" in event && typeof event.eventType === "string"
        ? event.eventType
        : null;
    const refundReference =
      eventData && typeof eventData === "object" && "refundReference" in eventData
        ? eventData.refundReference
        : null;

    if (
      (eventType === "SUCCESSFUL_REFUND" ||
        eventType === "FAILED_REFUND") &&
      typeof refundReference === "string"
    ) {
      const result = await updateMonnifyRefundStatus(
        refundReference,
        eventType === "SUCCESSFUL_REFUND" ? "completed" : "failed",
        eventData
      );
      return NextResponse.json({
        success: true,
        found: result.found,
        alreadyProcessed: result.alreadyProcessed,
      });
    }

    if (
      eventType !== "SUCCESSFUL_TRANSACTION" &&
      eventType !== "REJECTED_PAYMENT"
    ) {
      console.info(`Ignoring Monnify event type: ${eventType ?? "unknown"}`);
      return NextResponse.json({ success: true, ignored: true });
    }

    const paymentReference =
      eventData && typeof eventData === "object" && "paymentReference" in eventData
        ? eventData.paymentReference
        : null;

    if (typeof paymentReference !== "string" || !paymentReference) {
      return NextResponse.json(
        { error: "Missing payment reference" },
        { status: 400 }
      );
    }

    // Always verify directly with Monnify. A signed webhook is a notification,
    // not sufficient evidence to issue tickets.
    const result = await verifyAndFinalizeMonnifyPayment(paymentReference);
    if (result.status === "unknown") {
      console.info(`Monnify webhook for unknown reference: ${paymentReference}`);
      return NextResponse.json({ success: true, message: "Unknown reference" });
    }
    return NextResponse.json({
      success: true,
      status: result.status,
      ...(result.status === "paid" || result.status === "failed"
        ? { orderId: result.result.ok ? result.result.orderId : undefined }
        : {}),
    });
  } catch (error) {
    console.error("Monnify webhook processing failed:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
