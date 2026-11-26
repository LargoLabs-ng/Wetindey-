import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { WordMark } from "@/components/wordmark";
import { safeCallbackPath } from "@/lib/safe-redirect";
import {
  getOwnedOrganizations,
  isHostingOrganization,
  pickSetupTarget,
} from "@/lib/organiser-setup";
import { SetupForm } from "./setup-form";

/**
 * /organiser/setup — the one-time "who are you?" screen for a new organiser.
 *
 * Lives outside /dashboard on purpose. The dashboard sends door staff to the
 * scanner, so a volunteer who wants to host their own event could never
 * reach a setup screen inside it. Here, anyone signed in can set up their
 * OWN organisation; nothing on this page reads anyone else's.
 */
export default async function OrganiserSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = safeCallbackPath(params.next ?? null, "/dashboard/events/new");

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    const back = `/organiser/setup?next=${encodeURIComponent(next)}`;
    redirect(`/login?callbackUrl=${encodeURIComponent(back)}`);
  }

  const owned = await getOwnedOrganizations(userId);
  const target = pickSetupTarget(owned);

  // Already done: nothing to ask. Straight on to wherever they were going.
  if (target && isHostingOrganization(target)) redirect(next);

  return (
    <main className="wd-night min-h-screen bg-cream px-4 py-8 sm:py-14">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 flex items-center justify-between">
          <WordMark />
          <Link href="/" className="text-sm font-medium text-ink-2 hover:text-ink">
            Not now
          </Link>
        </div>

        <p className="text-xs font-bold uppercase tracking-[0.12em] text-purple">
          Set up to host
        </p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
          Who&apos;s putting on the event?
        </h1>
        <p className="mt-2 text-ink-2">
          This name and logo appear on your event pages and on every ticket.
          You can change them later in Settings.
        </p>

        <SetupForm
          initialName={target?.name ?? ""}
          initialLogoUrl={target?.logoUrl ?? null}
          next={next}
        />
      </div>
    </main>
  );
}
