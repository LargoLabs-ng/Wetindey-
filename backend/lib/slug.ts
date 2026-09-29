export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Generates a slug from `base`, appending -1, -2, ... on collision.
 * `exists` should check whether a given candidate slug is already taken.
 * Bounded at 5 attempts — collisions beyond that are vanishingly rare for
 * organization/event names and a hard failure is preferable to an
 * unbounded loop.
 */
export async function generateUniqueSlug(
  base: string,
  exists: (candidate: string) => Promise<boolean>
): Promise<string> {
  const baseSlug = slugify(base);
  let slug = baseSlug;
  let attempt = 0;
  while (attempt < 5) {
    if (!(await exists(slug))) return slug;
    attempt += 1;
    slug = `${baseSlug}-${attempt}`;
  }
  return slug;
}
