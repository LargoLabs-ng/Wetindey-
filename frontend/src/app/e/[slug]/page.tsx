import { redirect } from "next/navigation";
import { eventPathWithRef, refFromQuery } from "@/lib/referral";

/**
 * Short share link. The landing page promises "<host>/e/your-event", and that
 * is what organizers paste into WhatsApp, so the path has to exist; the real
 * page lives at /events/[slug].
 *
 * Promoters share it too, as `/e/<slug>?p=CODE`, so the code has to survive
 * the redirect — dropping it meant every sale through a promoter's link was
 * credited to nobody. Only the code is carried over; anything else on the
 * address is left behind.
 */
export default async function ShortEventLink({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const first = (name: string) => {
    const value = query[name];
    return Array.isArray(value) ? value[0] : value;
  };

  redirect(eventPathWithRef(slug, refFromQuery(first)));
}
