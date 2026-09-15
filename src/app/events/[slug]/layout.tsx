import type { Metadata } from "next";
import { db } from "@/db";
import { events } from "@/db/schema";
import { eq } from "drizzle-orm";
import { appUrl } from "@/lib/app-url";

/**
 * The event page itself is a client component (it runs the checkout), so it
 * cannot export generateMetadata. This server layout wraps it purely to emit
 * the link preview: without it, every event link pasted into WhatsApp renders
 * as a bare "Ticket Buddy" card with no title, no date and no image, and
 * search engines see an empty shell.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  let event;
  try {
    event = await db.query.events.findFirst({
      where: eq(events.slug, slug),
    });
  } catch {
    // A metadata failure must never take the page down with it.
    return { title: "Event · Ticket Buddy" };
  }

  if (!event || event.status !== "published") {
    return { title: "Event · Ticket Buddy", robots: { index: false } };
  }

  const where = [event.venueName, event.city].filter(Boolean).join(", ");
  const when = new Date(event.startDatetime).toLocaleString("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Africa/Lagos",
  });

  const description =
    event.description?.slice(0, 200) ||
    [when, where].filter(Boolean).join(" · ") ||
    "Get your tickets on Ticket Buddy.";

  const url = appUrl(`/events/${event.slug}`);
  const image = event.coverImage
    ? event.coverImage.startsWith("http")
      ? event.coverImage
      : appUrl(event.coverImage)
    : undefined;

  return {
    title: `${event.title} · Ticket Buddy`,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      title: event.title,
      description,
      url,
      siteName: "Ticket Buddy",
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: event.title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export default function EventLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
