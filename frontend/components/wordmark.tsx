import Link from "next/link";

/**
 * The Wetin Dey wordmark.
 *
 * Deliberately typographic rather than an image: the brand asset in the
 * build document is the question mark itself, and setting it in the brand
 * face means it stays sharp at any size, inherits the theme, needs no
 * network request, and never ships as a stale PNG. The old Ticket Buddy
 * padlock mark is left untouched in /public — it belongs to the old brand,
 * and a replacement mark is a design decision, not an engineering one.
 */
export function WordMark({
  tone = "light",
  size = "md",
  asLink = true,
  href = "/",
  className = "",
}: {
  /** "light" = dark text on a pale ground. "dark" = pale text on indigo. */
  tone?: "light" | "dark";
  size?: "sm" | "md" | "lg";
  asLink?: boolean;
  href?: string;
  className?: string;
}) {
  const sizes = {
    sm: "text-base",
    md: "text-lg",
    lg: "text-2xl",
  } as const;

  const body = (
    <span
      className={`inline-flex items-baseline font-extrabold tracking-[-0.035em] ${sizes[size]} ${
        tone === "dark" ? "text-on-dark" : "text-ink"
      } ${className}`}
    >
      Wetin&nbsp;Dey
      <span
        aria-hidden="true"
        className={tone === "dark" ? "text-purple-lift" : "text-purple"}
      >
        ?
      </span>
    </span>
  );

  if (!asLink) return body;

  return (
    <Link href={href} className="inline-flex items-center" aria-label="Wetin Dey — home">
      {body}
    </Link>
  );
}
