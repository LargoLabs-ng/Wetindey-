import Image from "next/image";
import Link from "next/link";
import logoLight from "@/assets/logo light.png";
import logoDark from "@/assets/logo dark.png";

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
  const sizes = { sm: "h-8 w-8", md: "h-10 w-10", lg: "h-14 w-14" } as const;

  const body = (
    <span className={`inline-flex shrink-0 items-center ${className}`}>
      <span
        className={`wd-logo wd-logo--${tone === "dark" ? "on-dark" : "adaptive"} relative inline-flex shrink-0 overflow-hidden ${sizes[size]}`}
      >
        <Image
          src={logoDark}
          alt="Wetin Dey"
          className="wd-logo__dark absolute inset-0 h-full w-full scale-[2.42] object-contain"
          priority={size === "lg"}
        />
        <Image
          src={logoLight}
          alt=""
          aria-hidden="true"
          className="wd-logo__light absolute inset-0 hidden h-full w-full scale-[2.42] object-contain"
          priority={size === "lg"}
        />
      </span>
      <span
        aria-hidden="true"
        className={`ml-2 hidden whitespace-nowrap font-display font-extrabold tracking-[-0.035em] sm:inline ${
          tone === "dark" ? "text-on-dark" : "text-ink"
        }`}
      >
        Wetin Dey<span className="text-amber">?</span>
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
