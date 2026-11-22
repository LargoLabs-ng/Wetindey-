import Link from "next/link";
import { WordMark } from "@/components/wordmark";
import { safeCallbackPath } from "@/lib/safe-redirect";

/**
 * Where an email-verification link lands when it can't be used: expired,
 * copied wrongly, or for an address the account no longer has. A link that
 * works never shows this page — it goes straight back to where the person
 * was buying.
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; next?: string }>;
}) {
  const params = await searchParams;
  const next = safeCallbackPath(params.next ?? null, "/");

  return (
    <main className="wd-night flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mb-6">
          <WordMark size="lg" />
        </div>
        <h1 className="text-2xl font-bold text-ink">That link no longer works</h1>
        <p className="mt-2 text-ink-2">
          Confirmation links last 24 hours. Go back to the event and tap
          &ldquo;Send link&rdquo; to get a fresh one.
        </p>
        <Link
          href={next}
          className="mt-6 inline-block w-full rounded-xl bg-purple py-3 font-semibold text-white hover:bg-purple-deep"
        >
          Go back
        </Link>
      </div>
    </main>
  );
}
