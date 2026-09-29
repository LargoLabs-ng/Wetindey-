import { notFound } from "next/navigation";
import { requireEventCapability } from "@/lib/authz";
import { CheckInConsole } from "@/components/check-in-console";

export default async function DashboardCheckInPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;

  const access = await requireEventCapability(eventId, "checkin:perform");
  if (!access.ok) notFound();

  return (
    <CheckInConsole
      eventId={eventId}
      eventTitle={access.event.title}
      backHref={`/dashboard/events/${eventId}`}
    />
  );
}
