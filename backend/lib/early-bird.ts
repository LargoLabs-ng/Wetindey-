export type EarlyBirdPricing = {
  price: string | number;
  earlyBirdEnabled: boolean;
  earlyBirdPrice: string | number | null;
  earlyBirdEndsAt: Date | string | null;
};

export type ActiveTicketPrice = {
  price: number;
  priceMinor: number;
  earlyBirdActive: boolean;
};

export type TicketPriceVersion = EarlyBirdPricing & {
  validFrom: Date | string;
  validUntil: Date | string | null;
};

export function ticketPriceConfigurationAt(
  versions: TicketPriceVersion[],
  at: Date
): EarlyBirdPricing | null {
  const timestamp = at.getTime();
  if (!Number.isFinite(timestamp)) return null;

  const version = versions.find((candidate) => {
    const validFrom =
      typeof candidate.validFrom === "string"
        ? Date.parse(candidate.validFrom)
        : candidate.validFrom.getTime();
    const validUntil =
      candidate.validUntil === null
        ? Infinity
        : typeof candidate.validUntil === "string"
          ? Date.parse(candidate.validUntil)
          : candidate.validUntil.getTime();
    return (
      Number.isFinite(validFrom) &&
      timestamp >= validFrom &&
      (validUntil === Infinity ||
        (Number.isFinite(validUntil) && timestamp < validUntil))
    );
  });

  return version
    ? {
        price: version.price,
        earlyBirdEnabled: version.earlyBirdEnabled,
        earlyBirdPrice: version.earlyBirdPrice,
        earlyBirdEndsAt: version.earlyBirdEndsAt,
      }
    : null;
}

export function toMinorUnits(value: string | number): number {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return NaN;
  return Math.round(amount * 100);
}

export function isValidEarlyBirdConfiguration(
  regularPrice: number,
  earlyBirdPrice: number | null,
  deadline: Date | null
): boolean {
  return (
    Number.isFinite(regularPrice) &&
    regularPrice >= 0 &&
    earlyBirdPrice !== null &&
    Number.isFinite(earlyBirdPrice) &&
    earlyBirdPrice >= 0 &&
    toMinorUnits(earlyBirdPrice) < toMinorUnits(regularPrice) &&
    deadline !== null &&
    Number.isFinite(deadline.getTime())
  );
}

export function checkoutPriceChanged(
  snapshot: string | null,
  activePrice: ActiveTicketPrice | null,
  legacyFaceValueMinor: number | null = null,
  quantity = 0
): boolean {
  if (activePrice === null) {
    return snapshot !== null || legacyFaceValueMinor !== null;
  }
  if (snapshot !== null) {
    return toMinorUnits(snapshot) !== activePrice.priceMinor;
  }
  return (
    legacyFaceValueMinor !== null &&
    Number.isSafeInteger(legacyFaceValueMinor) &&
    Number.isInteger(quantity) &&
    quantity > 0 &&
    legacyFaceValueMinor !== activePrice.priceMinor * quantity
  );
}

export function activeTicketPrice(
  ticket: EarlyBirdPricing,
  now: Date | number
): ActiveTicketPrice {
  const deadlineTime =
    ticket.earlyBirdEndsAt === null
      ? NaN
      : typeof ticket.earlyBirdEndsAt === "string"
        ? Date.parse(ticket.earlyBirdEndsAt)
        : ticket.earlyBirdEndsAt.getTime();
  const earlyBirdActive =
    ticket.earlyBirdEnabled &&
    ticket.earlyBirdPrice !== null &&
    Number.isFinite(Number(ticket.earlyBirdPrice)) &&
    Number.isFinite(deadlineTime) &&
    (typeof now === "number" ? now : now.getTime()) < deadlineTime;
  const price = earlyBirdActive
    ? Number(ticket.earlyBirdPrice)
    : Number(ticket.price);

  return {
    price,
    priceMinor: toMinorUnits(price),
    earlyBirdActive,
  };
}

export function datetimeLocalToUtc(
  value: string,
  timeZone: string
): Date | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match.map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  const targetDate = new Date(target);
  if (
    targetDate.getUTCFullYear() !== year ||
    targetDate.getUTCMonth() !== month - 1 ||
    targetDate.getUTCDate() !== day ||
    targetDate.getUTCHours() !== hour ||
    targetDate.getUTCMinutes() !== minute
  ) {
    return null;
  }

  try {
    const format = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    let candidate = target;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = Object.fromEntries(
        format
          .formatToParts(new Date(candidate))
          .filter((part) => part.type !== "literal")
          .map((part) => [part.type, Number(part.value)])
      );
      const represented = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute
      );
      candidate += target - represented;
    }

    const result = new Date(candidate);
    return datetimeLocalFromUtc(result, timeZone) === value ? result : null;
  } catch {
    return null;
  }
}

export function datetimeLocalFromUtc(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

export function formatDeadline(date: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-NG", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}
