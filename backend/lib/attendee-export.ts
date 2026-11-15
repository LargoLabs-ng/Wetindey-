import { promoKindLabel, type OrderCode } from "./promo";

/**
 * The promo-code columns of the guest-list CSV.
 *
 * Kept apart from the route so the money rule is testable: the naira amount
 * only appears for people who can see the event's finances (finance:view),
 * the same rule as the payouts page. Everyone who can download the guest
 * list sees which code was used.
 *
 * The discount belongs to the ORDER, not the ticket — three tickets bought
 * together share one discount. Each of their rows repeats it, labelled as the
 * order's, with the order ID beside it so nobody adds it up three times.
 */
export function promoExportHeader(canSeeFinances: boolean): string[] {
  return [
    "Promo code",
    "Code type",
    "Order ID",
    ...(canSeeFinances ? ["Order discount (NGN)"] : []),
  ];
}

export function promoExportCells(
  input: {
    orderId: string;
    orderCode: OrderCode | null;
    discountAmount: string | number | null | undefined;
  },
  canSeeFinances: boolean
): string[] {
  const { orderCode } = input;
  const discount = Number(input.discountAmount);
  return [
    orderCode?.code ?? "",
    orderCode ? promoKindLabel(orderCode.kind) : "",
    shortOrderId(input.orderId),
    ...(canSeeFinances
      ? [orderCode && Number.isFinite(discount) ? discount.toFixed(2) : ""]
      : []),
  ];
}

/** Same shape as the Ticket ID column: first 8 characters, upper case. */
export function shortOrderId(orderId: string): string {
  return orderId.slice(0, 8).toUpperCase();
}
