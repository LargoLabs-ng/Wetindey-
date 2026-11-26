import { Suspense } from "react";
import DiscoverClient from "./discover-client";

/**
 * Discover reads its filters from the address bar, which Next only knows in
 * the browser — so the page renders inside Suspense, as useSearchParams
 * requires.
 */
export default function DiscoverPage() {
  return (
    <Suspense>
      <DiscoverClient />
    </Suspense>
  );
}
