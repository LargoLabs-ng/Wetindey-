import { Suspense } from "react";
import { redirect } from "next/navigation";
import { NewEventWizard } from "@/components/new-event-wizard";
import { getSessionUserId } from "@/lib/authz";
import { getOwnedOrganizations, needsOrganiserSetup } from "@/lib/organiser-setup";

export default async function NewEventPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  // A brand-new organiser names their organisation (and can add a logo)
  // before their first event, instead of it being created silently as
  // "<name>'s Events". Skipped when resuming a draft (?event=…): that
  // person already has an event, so setup is not what they need.
  const params = await searchParams;
  if (!params.event) {
    const userId = await getSessionUserId();
    if (userId && needsOrganiserSetup(await getOwnedOrganizations(userId))) {
      redirect("/organiser/setup?next=%2Fdashboard%2Fevents%2Fnew");
    }
  }

  // The wizard keeps its step and draft id in the URL, so it reads
  // searchParams — which needs a Suspense boundary or the build fails.
  return (
    <Suspense fallback={<p className="text-on-dark-2">Loading…</p>}>
      <NewEventWizard />
    </Suspense>
  );
}
