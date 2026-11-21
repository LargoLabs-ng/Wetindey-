/**
 * The public "N+ going" badge.
 *
 * Buyers see social proof, never the exact number of people holding
 * tickets. The real count is unchanged in the database and stays exact
 * everywhere organisers look at their own numbers; this only decides what
 * the public badge says.
 *
 *   fewer than 9 going   → no badge
 *   9–19                 → "9+ going"
 *   20–49                → "20+ going"
 *   50–99                → "50+ going"
 *   then 100, 200, 500, 1,000, 2,000, 5,000, 10,000 …
 *
 * "Going" counts people with a confirmed ticket: paid or checked in, never
 * pending, cancelled or refunded. A table ticket that admits six counts as
 * six, as it always has.
 *
 * Pure (no database), so the thresholds are unit-tested.
 */

export const GOING_THRESHOLDS = [
  9, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000,
] as const;

/**
 * Per-event floors set by hand, keyed by event id (ids never change; slugs
 * can). The badge shows the higher of this floor and the real one, so it
 * still climbs once real sales pass it.
 */
export const GOING_DISPLAY_OVERRIDES: Readonly<Record<string, number>> = {
  // TEDxUNIUYO (slug "tedxuniuyo", 28 Nov 2026). Display floor requested by
  // the owner on 19 Nov 2026.
  "2ff1e511-3d1e-4f1a-aa56-b40b991dfdd1": 80,
};

/** The highest threshold the real count has reached, or null below the first. */
export function goingFloor(count: number): number | null {
  if (!Number.isFinite(count)) return null;
  let floor: number | null = null;
  for (const step of GOING_THRESHOLDS) {
    if (count >= step) floor = step;
    else break;
  }
  return floor;
}

/** What the public badge may say for this event: a floor, or null for no badge. */
export function publicGoingFloor(eventId: string, confirmedCount: number): number | null {
  const real = goingFloor(confirmedCount);
  const override = GOING_DISPLAY_OVERRIDES[eventId];
  if (override === undefined) return real;
  return Math.max(override, real ?? 0);
}

/** "9+ going", "1,000+ going". Cards render it in capitals. */
export function goingLabel(floor: number | null | undefined): string | null {
  if (!floor || floor <= 0) return null;
  return `${floor.toLocaleString("en-NG")}+ going`;
}
