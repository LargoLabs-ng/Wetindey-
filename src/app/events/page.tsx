import { redirect } from "next/navigation";

/**
 * The old browse page lived here. Discovery is now /discover, and this path
 * redirects rather than 404s because it has been shared and linked to.
 * /events/[slug] is untouched — only this index moved.
 */
export default function EventsIndex() {
  redirect("/discover");
}
