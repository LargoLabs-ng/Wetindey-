import { redirect } from "next/navigation";

/**
 * Short share link. The landing page promises "<host>/e/your-event", and that
 * is what organizers paste into WhatsApp, so the path has to exist; the real
 * page lives at /events/[slug].
 */
export default async function ShortEventLink({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/events/${encodeURIComponent(slug)}`);
}
