import AdminEventAnalytics from "./event-analytics";

export default async function AdminEventAnalyticsPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return <AdminEventAnalytics eventId={eventId} />;
}
