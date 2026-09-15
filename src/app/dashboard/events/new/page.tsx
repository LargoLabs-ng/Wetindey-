import { Suspense } from "react";
import { NewEventWizard } from "@/components/new-event-wizard";

export default function NewEventPage() {
  // The wizard keeps its step and draft id in the URL, so it reads
  // searchParams — which needs a Suspense boundary or the build fails.
  return (
    <Suspense fallback={<p className="text-on-dark-2">Loading…</p>}>
      <NewEventWizard />
    </Suspense>
  );
}
