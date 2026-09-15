import Image from "next/image";
import { isOptimizable } from "@/lib/image-url";

/**
 * Renders an event cover safely wherever it came from.
 *
 * Images we host go through next/image (resizing, modern formats, lazy
 * loading). Anything else — a URL an organizer pasted before uploads
 * existed — renders as a plain <img>, because next/image refuses hosts that
 * aren't in remotePatterns and throws rather than degrading.
 */
export function EventImage({
  src,
  alt,
  priority = false,
  className = "",
  sizes = "100vw",
}: {
  src: string | null | undefined;
  alt: string;
  priority?: boolean;
  className?: string;
  sizes?: string;
}) {
  if (!src) return null;

  if (isOptimizable(src)) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        priority={priority}
        sizes={sizes}
        className={`object-cover ${className}`}
      />
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      className={`absolute inset-0 h-full w-full object-cover ${className}`}
    />
  );
}
