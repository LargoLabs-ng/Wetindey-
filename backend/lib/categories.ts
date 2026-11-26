/**
 * Grouping organiser-typed categories for browsing.
 *
 * Categories are free text (decision D5): organisers type whatever they
 * like, so "Party", "party", "Parties " and "Party." all turn up. Stored
 * values are never changed. This only decides which of them count as the
 * same thing on the home page and in Discover's filters, and what to call
 * the group.
 *
 * Deliberately modest: case, spacing and stray punctuation are ignored, and
 * a trailing plural "s" is folded ("Parties" → "party", "Seminars" →
 * "seminar"). Anything cleverer (synonyms, spelling mistakes) would need a
 * human to curate, which is what a fixed list would have been.
 */

/** The grouping key: "Parties." → "party", "  Tech  Talks " → "tech talk". */
export function categoryKey(raw: string | null | undefined): string {
  if (!raw) return "";
  let key = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (!key) return "";
  // Fold a simple plural on the last word only.
  key = key.replace(/(\w{3,})ies$/, "$1y").replace(/(\w{3,}[^s])s$/, "$1");
  return key;
}

/** How a stored category reads on screen: trimmed, no trailing punctuation. */
export function categoryLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").replace(/[.,;:!?]+$/, "");
}

export type CategoryGroup = { key: string; name: string; count: number };

/**
 * Group category values (one per event) into chips, biggest first. Each
 * group is named by its most common spelling, so "Party" wins over "party."
 * when more organisers wrote it that way. Ties go to a capitalised spelling,
 * then the shorter one ("Party" over "Parties"), then alphabetical order,
 * so the name doesn't flicker between page loads.
 */
export function groupCategories(values: Array<string | null | undefined>): CategoryGroup[] {
  const groups = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const raw of values) {
    const key = categoryKey(raw);
    if (!key || !raw) continue;
    const label = categoryLabel(raw);
    const group = groups.get(key) ?? { count: 0, spellings: new Map<string, number>() };
    group.count += 1;
    group.spellings.set(label, (group.spellings.get(label) ?? 0) + 1);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([key, g]) => {
      const capitalised = (s: string) => (/^[A-Z]/.test(s) ? 0 : 1);
      const name = [...g.spellings.entries()].sort(
        (a, b) =>
          b[1] - a[1] ||
          capitalised(a[0]) - capitalised(b[0]) ||
          a[0].length - b[0].length ||
          a[0].localeCompare(b[0])
      )[0][0];
      return { key, name, count: g.count };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
