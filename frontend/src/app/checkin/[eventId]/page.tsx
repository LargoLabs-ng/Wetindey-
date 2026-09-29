import { notFound } from "next/navigation";
import { requireEventCapability } from "@/lib/authz";
import { CheckInConsole } from "@/components/check-in-console";

export default async function GateCheckInPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;

  // Same gate as the API: no capability, no scanner.
  const access = await requireEventCapability(eventId, "checkin:perform");
  if (!access.ok) notFound();

  return <CheckInConsole eventId={eventId} eventTitle={access.event.title} />;
}
