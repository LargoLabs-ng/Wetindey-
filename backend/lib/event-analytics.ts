const DAY_MS = 24 * 60 * 60 * 1000;
const TICKET_STATUSES_THAT_COUNT_AS_SOLD = new Set(["valid", "checked_in"]);

type AnalyticsOrder = {
  id: string;
  createdAt: Date;
  subtotal: number | string;
};

type AnalyticsTicket = {
  orderId: string;
  status: string;
};

type EventAnalyticsInput = {
  now: Date;
  eventStart: Date;
  eventDateTbd: boolean;
  eventStatus: string;
  ticketsTotal: number;
  ticketsSold: number;
  orders: AnalyticsOrder[];
  tickets: AnalyticsTicket[];
};

export type EventAnalytics = {
  dailySales: Array<{ date: string; tickets: number; revenue: number }>;
  ticketsLast7Days: number;
  ticketsPrevious7Days: number;
  ticketSalesLast7Days: number;
  averageDailyTickets: number;
  sellThroughPercent: number;
  salesTrend: "up" | "down" | "flat" | "new";
  salesChangePercent: number | null;
  estimatedSellOutAt: string | null;
  requiredDailyTickets: number | null;
  insight: string;
};

function utcDayStart(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function asAmount(amount: number | string): number {
  const parsed = typeof amount === "number" ? amount : Number(amount);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function analyzeEventSales(input: EventAnalyticsInput): EventAnalytics {
  const today = utcDayStart(input.now);
  const chartStart = today - 7 * DAY_MS;
  const previousStart = today - 14 * DAY_MS;
  const dates = Array.from({ length: 7 }, (_, index) =>
    new Date(chartStart + index * DAY_MS).toISOString().slice(0, 10)
  );
  const dailySales = dates.map((date) => ({ date, tickets: 0, revenue: 0 }));
  const dayIndexes = new Map(dates.map((date, index) => [date, index]));

  const ticketsByOrder = new Map<string, number>();
  const paidOrderIds = new Set(input.orders.map((order) => order.id));
  for (const ticket of input.tickets) {
    if (
      paidOrderIds.has(ticket.orderId) &&
      TICKET_STATUSES_THAT_COUNT_AS_SOLD.has(ticket.status)
    ) {
      ticketsByOrder.set(
        ticket.orderId,
        (ticketsByOrder.get(ticket.orderId) ?? 0) + 1
      );
    }
  }

  let ticketsLast7Days = 0;
  let ticketsPrevious7Days = 0;
  let ticketSalesLast7Days = 0;

  for (const order of input.orders) {
    const ticketCount = ticketsByOrder.get(order.id) ?? 0;
    if (ticketCount === 0) continue;

    const createdAt = order.createdAt.getTime();
    if (createdAt < previousStart || createdAt >= today) continue;

    const date = new Date(createdAt).toISOString().slice(0, 10);
    const amount = asAmount(order.subtotal);
    if (createdAt < chartStart) {
      ticketsPrevious7Days += ticketCount;
      continue;
    }

    ticketsLast7Days += ticketCount;
    ticketSalesLast7Days += amount;
    const dayIndex = dayIndexes.get(date);
    if (dayIndex !== undefined) {
      dailySales[dayIndex].tickets += ticketCount;
      dailySales[dayIndex].revenue += amount;
    }
  }

  const salesTrend =
    ticketsLast7Days === 0 && ticketsPrevious7Days === 0
      ? "flat"
      : ticketsPrevious7Days === 0
        ? "new"
        : ticketsLast7Days > ticketsPrevious7Days
          ? "up"
          : ticketsLast7Days < ticketsPrevious7Days
            ? "down"
            : "flat";
  const salesChangePercent =
    ticketsPrevious7Days === 0
      ? null
      : Math.round(
          ((ticketsLast7Days - ticketsPrevious7Days) /
            ticketsPrevious7Days) *
            100
        );

  const ticketsRemaining = Math.max(
    0,
    input.ticketsTotal - input.ticketsSold
  );
  const averageDailyTickets = Number((ticketsLast7Days / 7).toFixed(1));
  const sellThroughPercent =
    input.ticketsTotal > 0
      ? Math.min(
          100,
          Math.round((input.ticketsSold / input.ticketsTotal) * 100)
        )
      : 0;

  const daysUntilEvent =
    input.eventStart.getTime() > input.now.getTime()
      ? (input.eventStart.getTime() - input.now.getTime()) / DAY_MS
      : 0;
  const requiredDailyTickets =
    !input.eventDateTbd && daysUntilEvent > 0 && ticketsRemaining > 0
      ? Number((ticketsRemaining / daysUntilEvent).toFixed(1))
      : null;
  const daysToSellOut =
    averageDailyTickets > 0 ? ticketsRemaining / averageDailyTickets : null;
  const estimatedSellOutAt =
    input.eventStatus === "published" &&
    !input.eventDateTbd &&
    daysToSellOut !== null &&
    daysToSellOut <= daysUntilEvent
      ? new Date(input.now.getTime() + daysToSellOut * DAY_MS).toISOString()
      : null;

  let insight: string;
  if (input.ticketsTotal <= 0) {
    insight = "Add ticket tiers to start tracking sales and event capacity.";
  } else if (input.ticketsSold >= input.ticketsTotal) {
    insight = "All available tickets are sold. Your event has reached capacity.";
  } else if (input.eventStatus !== "published") {
    insight = "Publish your event to make its public ticket page available.";
  } else if (ticketsLast7Days === 0) {
    insight =
      "No ticket sales in the last 7 days. Share your event page to bring in more buyers.";
  } else if (sellThroughPercent >= 90) {
    insight = `You're nearly sold out, with ${ticketsRemaining} ${
      ticketsRemaining === 1 ? "ticket" : "tickets"
    } remaining.`;
  } else if (estimatedSellOutAt) {
    insight = `At your recent pace of ${averageDailyTickets} tickets a day, you could sell out before the event.`;
  } else if (
    requiredDailyTickets !== null &&
    averageDailyTickets < requiredDailyTickets
  ) {
    insight = `You're averaging ${averageDailyTickets} tickets a day. Selling out by event day would take about ${requiredDailyTickets} a day.`;
  } else if (salesTrend === "up" && salesChangePercent !== null) {
    insight = `Sales are up ${salesChangePercent}% compared with the previous 7 days.`;
  } else if (salesTrend === "down" && salesChangePercent !== null) {
    insight = `Sales are down ${Math.abs(salesChangePercent)}% compared with the previous 7 days.`;
  } else if (salesTrend === "new") {
    insight = "Sales started this week. Keep sharing your event page to build momentum.";
  } else {
    insight = "Sales are holding steady compared with the previous 7 days.";
  }

  return {
    dailySales,
    ticketsLast7Days,
    ticketsPrevious7Days,
    ticketSalesLast7Days: Math.round(ticketSalesLast7Days),
    averageDailyTickets,
    sellThroughPercent,
    salesTrend,
    salesChangePercent,
    estimatedSellOutAt,
    requiredDailyTickets,
    insight,
  };
}
